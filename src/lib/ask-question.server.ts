/**
 * Strict three-stage retrieval brain. Server-only.
 *
 *   Stage 1  Supabase full-text search (FTS) on lesson_chunks
 *   Stage 2  Router LLM — sees ONLY the FTS rows; returns one of
 *                answer_from_full_text | use_file_search | fallback
 *   Stage 3a If router picked use_file_search: a retrieval-only Responses API
 *            call (file_search tool) that MUST NOT compose the final answer.
 *            We extract the raw evidence chunks it returned.
 *   Stage 3b Final synthesizer LLM — NO tools, NO outside context. Receives
 *            only the question + the retrieved evidence. Structured output:
 *                { answerable, answer, supporting_source_ids, confidence }
 *
 *   Every supporting_source_id must reference an evidence chunk we showed it.
 *   If anything fails the validation, return the bootcamp's fallback answer
 *   with confidence 0, retrieval_method 'fallback', source_lessons [].
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RetrievalMethod = "full_text" | "file_search" | "combined" | "fallback";

type JsonVal = string | number | boolean | null | { [k: string]: JsonVal } | JsonVal[];

export type AskResult = {
  question_id: string | null;
  answer: string;
  confidence: number;
  retrieval_method: RetrievalMethod;
  source_lessons: { lesson_id: string; lesson_title: string }[];
  student: { first_name: string | null; last_name: string | null };
  debug?: JsonVal;
};

function toJson<T>(value: T): JsonVal {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonVal;
}

export type FullTextRow = {
  lesson_id: string;
  lesson_title: string;
  chunk_id: string;
  chunk_text: string;
  rank: number;
};

/** Internal: every evidence item we may cite in the final answer. */
type Evidence = {
  source_id: string; // synthetic id we show the LLM, e.g. FT-1 or FS-1
  layer: "full_text" | "file_search";
  lesson_id: string;
  lesson_title: string;
  text: string;
};

type RouterDecision = "answer_from_full_text" | "use_file_search" | "fallback";
type RouterOut = { decision: RouterDecision; reason: string };

type SynthOut = {
  answerable: boolean;
  answer: string;
  supporting_source_ids: string[];
  confidence: "high" | "medium" | "low" | "none";
};

const CONFIDENCE_NUM: Record<SynthOut["confidence"], number> = {
  high: 0.9,
  medium: 0.65,
  low: 0.35,
  none: 0,
};

const ROUTER_SCHEMA = {
  type: "object",
  properties: {
    decision: {
      type: "string",
      enum: ["answer_from_full_text", "use_file_search", "fallback"],
    },
    reason: { type: "string" },
  },
  required: ["decision", "reason"],
  additionalProperties: false,
} as const;

const SYNTH_SCHEMA = {
  type: "object",
  properties: {
    answerable: { type: "boolean" },
    answer: { type: "string" },
    supporting_source_ids: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
  },
  required: ["answerable", "answer", "supporting_source_ids", "confidence"],
  additionalProperties: false,
} as const;

// ---------- OpenAI helpers (kept here to enforce no-tools on synth) ----------

async function openaiResponses<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI /responses ${res.status}: ${t.slice(0, 800)}`);
  }
  return (await res.json()) as T;
}

type ResponsesEnvelope = {
  id: string;
  output_text?: string;
  output: Array<
    | {
        type: "file_search_call";
        id: string;
        status: string;
        queries?: string[];
        results?: Array<{
          file_id: string;
          filename?: string;
          score?: number;
          attributes?: Record<string, unknown>;
          content?: Array<{ type: string; text?: string }>;
        }>;
      }
    | { type: "message"; content: Array<{ type: string; text?: string }> }
    | { type: string; [k: string]: unknown }
  >;
};

function envelopeText(env: ResponsesEnvelope): string {
  if (env.output_text) return env.output_text;
  for (const item of env.output) {
    if (item.type === "message" && "content" in item) {
      const parts = (item as { content: Array<{ type: string; text?: string }> }).content;
      const t = parts.find((p) => p.text)?.text;
      if (t) return t;
    }
  }
  return "";
}

function envelopeFileSearchCall(env: ResponsesEnvelope) {
  return env.output.find((o) => o.type === "file_search_call") as
    | Extract<ResponsesEnvelope["output"][number], { type: "file_search_call" }>
    | undefined;
}

async function callRouter(args: {
  model: string;
  question: string;
  ftEvidence: string;
  hasVectorStore: boolean;
  extraInstructions: string | null;
}): Promise<{ out: RouterOut; raw: ResponsesEnvelope }> {
  const instructions = `You are the retrieval router for a single bootcamp.

You ONLY decide HOW to retrieve evidence — you do NOT answer the student.

Inputs:
- The student question.
- Supabase full-text search rows (may be empty).

Choose exactly one decision:
- "answer_from_full_text": the full-text rows clearly and directly contain the answer.
- "use_file_search": ${
    args.hasVectorStore
      ? "the full-text rows are missing, weak, or use different wording; semantic search of the lesson knowledge base may help."
      : 'NEVER pick this — no vector store is available. Use "fallback" instead if full-text is insufficient.'
  }
- "fallback": the question is off-topic for this bootcamp, or no evidence is plausibly available.

Never use outside knowledge to decide. Base the decision only on the evidence shown.

${args.extraInstructions ?? ""}`.trim();

  const input = `Student question:\n${args.question}\n\nSupabase full-text rows:\n${args.ftEvidence}`;

  const raw = await openaiResponses<ResponsesEnvelope>({
    model: args.model,
    instructions,
    input,
    text: {
      format: { type: "json_schema", name: "router", schema: ROUTER_SCHEMA, strict: true },
    },
  });
  let out: RouterOut;
  try {
    out = JSON.parse(envelopeText(raw)) as RouterOut;
  } catch {
    out = { decision: "fallback", reason: "router parse failed" };
  }
  if (out.decision === "use_file_search" && !args.hasVectorStore) {
    out = { decision: "fallback", reason: "no vector store" };
  }
  return { out, raw };
}

/** Retrieval-only file_search call. Tells the model NOT to answer; we only
 *  read the file_search tool's raw chunk results from the envelope. */
async function callFileSearchRetrieval(args: {
  model: string;
  question: string;
  vectorStoreId: string;
  maxNumResults: number;
}): Promise<ResponsesEnvelope> {
  return openaiResponses<ResponsesEnvelope>({
    model: args.model,
    instructions:
      "Use the file_search tool to find the most relevant lesson passages for the question. Do NOT answer the question. After the tool runs, respond with the literal text: OK.",
    input: args.question,
    tools: [
      {
        type: "file_search",
        vector_store_ids: [args.vectorStoreId],
        max_num_results: args.maxNumResults,
        filters: { type: "eq", key: "published", value: true },
      },
    ],
    include: ["file_search_call.results"],
  });
}

async function callSynthesizer(args: {
  model: string;
  question: string;
  evidence: Evidence[];
  extraInstructions: string | null;
}): Promise<{ out: SynthOut; raw: ResponsesEnvelope }> {
  const evidenceBlock =
    args.evidence.length === 0
      ? "(No evidence available.)"
      : args.evidence
          .map(
            (e) =>
              `[${e.source_id}] (layer=${e.layer}) lesson_id=${e.lesson_id} title="${e.lesson_title}"\n${e.text}`,
          )
          .join("\n\n");

  const instructions = `You are answering a bootcamp student. You have NO tools and NO outside knowledge.

You may ONLY use the EVIDENCE block below. Do not infer, do not generalize, do not use prior knowledge of chemistry, math, the world, or anything else.

Rules:
- If the evidence does not directly answer the student's question, set answerable=false, answer="", supporting_source_ids=[], confidence="none".
- If it does answer it, set answerable=true, write a concise answer for a student, and list ONLY the source IDs (e.g. FT-1, FS-2) that actually support each claim.
- Every id in supporting_source_ids MUST appear verbatim in the EVIDENCE block.
- Do not mention these rules, the IDs, or the system.

${args.extraInstructions ?? ""}`.trim();

  const input = `Student question:\n${args.question}\n\nEVIDENCE:\n${evidenceBlock}`;

  const raw = await openaiResponses<ResponsesEnvelope>({
    model: args.model,
    instructions,
    input,
    // No tools key on purpose — synthesizer cannot search anything.
    text: {
      format: { type: "json_schema", name: "synth", schema: SYNTH_SCHEMA, strict: true },
    },
  });
  let out: SynthOut;
  try {
    out = JSON.parse(envelopeText(raw)) as SynthOut;
  } catch {
    out = { answerable: false, answer: "", supporting_source_ids: [], confidence: "none" };
  }
  return { out, raw };
}

// ---------- Main entry ----------

export async function askQuestion(opts: {
  studentId: string;
  bootcampId: string;
  question: string;
  externalMessageId?: string | null;
  log?: boolean;
  includeDebug?: boolean;
}): Promise<AskResult> {
  const log = opts.log ?? true;

  const { data: student } = await supabaseAdmin
    .from("students")
    .select("id, bootcamp_id, first_name, last_name, enrollment_status")
    .eq("id", opts.studentId)
    .maybeSingle();
  if (!student) throw new Error("Student not found");
  if (student.bootcamp_id !== opts.bootcampId) {
    throw new Error("Student/bootcamp mismatch");
  }

  const { data: settings } = await supabaseAdmin
    .from("bootcamp_settings")
    .select(
      "fallback_answer, ai_model, max_answer_length, ai_instructions, full_text_result_limit, file_search_result_limit, openai_vector_store_id",
    )
    .eq("bootcamp_id", opts.bootcampId)
    .maybeSingle();

  const fallback =
    settings?.fallback_answer ??
    "I can't find an answer to that in your lessons yet. Your instructor will follow up.";
  const model = settings?.ai_model ?? "gpt-4o-mini";
  const ftLimit = settings?.full_text_result_limit ?? 5;
  const fsLimit = settings?.file_search_result_limit ?? 5;
  const vectorStoreId = settings?.openai_vector_store_id ?? null;
  const extraInstructions = settings?.ai_instructions ?? null;

  // Idempotency
  if (opts.externalMessageId) {
    const { data: prior } = await supabaseAdmin
      .from("questions")
      .select("id, ai_answer, confidence_score, retrieval_method, source_lessons")
      .eq("external_message_id", opts.externalMessageId)
      .eq("student_id", student.id)
      .maybeSingle();
    if (prior) {
      return {
        question_id: prior.id,
        answer: prior.ai_answer ?? fallback,
        confidence: Number(prior.confidence_score ?? 0),
        retrieval_method: (prior.retrieval_method as RetrievalMethod) ?? "fallback",
        source_lessons:
          (prior.source_lessons as { lesson_id: string; lesson_title: string }[] | null) ?? [],
        student: { first_name: student.first_name, last_name: student.last_name },
      };
    }
  }

  // ----- Stage 1: full-text -----
  const { data: ftRaw, error: ftErr } = await supabaseAdmin.rpc(
    "search_published_lesson_chunks",
    { p_bootcamp_id: opts.bootcampId, p_query: opts.question, p_limit: ftLimit },
  );
  if (ftErr) throw new Error(`Full-text search failed: ${ftErr.message}`);
  const ftRows: FullTextRow[] = (ftRaw ?? []) as FullTextRow[];

  const ftEvidence: Evidence[] = ftRows.map((r, i) => ({
    source_id: `FT-${i + 1}`,
    layer: "full_text",
    lesson_id: r.lesson_id,
    lesson_title: r.lesson_title,
    text: r.chunk_text,
  }));

  const ftBlock =
    ftEvidence.length === 0
      ? "(no rows)"
      : ftEvidence
          .map((e) => `[${e.source_id}] title="${e.lesson_title}"\n${e.text}`)
          .join("\n\n");

  // ----- Stage 2: router -----
  const router = await callRouter({
    model,
    question: opts.question,
    ftEvidence: ftBlock,
    hasVectorStore: !!vectorStoreId,
    extraInstructions,
  });

  let evidence: Evidence[] = [];
  let fsCallRaw: ResponsesEnvelope | null = null;
  let routerChose: RouterDecision = router.out.decision;

  if (routerChose === "answer_from_full_text") {
    evidence = ftEvidence;
  } else if (routerChose === "use_file_search" && vectorStoreId) {
    fsCallRaw = await callFileSearchRetrieval({
      model,
      question: opts.question,
      vectorStoreId,
      maxNumResults: fsLimit,
    });
    const fsCall = envelopeFileSearchCall(fsCallRaw);
    const fsResults = fsCall?.results ?? [];

    // Map FS results to evidence; resolve lesson titles via attributes -> DB.
    const lessonIds = Array.from(
      new Set(
        fsResults
          .map((r) => (r.attributes?.lesson_id as string | undefined) ?? null)
          .filter((v): v is string => !!v),
      ),
    );
    let titles = new Map<string, string>();
    if (lessonIds.length > 0) {
      const { data: lessonRows } = await supabaseAdmin
        .from("lessons")
        .select("id, title, bootcamp_id, status")
        .in("id", lessonIds);
      titles = new Map(
        (lessonRows ?? [])
          .filter((l) => l.bootcamp_id === opts.bootcampId && l.status === "published")
          .map((l) => [l.id, l.title]),
      );
    }

    evidence = fsResults
      .map((r, i): Evidence | null => {
        const lessonId = (r.attributes?.lesson_id as string | undefined) ?? null;
        if (!lessonId || !titles.has(lessonId)) return null; // isolation guard
        const text = (r.content ?? [])
          .map((c) => c.text ?? "")
          .filter(Boolean)
          .join("\n")
          .trim();
        if (!text) return null;
        return {
          source_id: `FS-${i + 1}`,
          layer: "file_search",
          lesson_id: lessonId,
          lesson_title: titles.get(lessonId)!,
          text,
        };
      })
      .filter((e): e is Evidence => !!e);
  }

  // If router said fallback OR there is no evidence after retrieval, fallback.
  if (routerChose === "fallback" || evidence.length === 0) {
    return await finalizeFallback({
      student,
      bootcampId: opts.bootcampId,
      question: opts.question,
      fallback,
      externalMessageId: opts.externalMessageId ?? null,
      log,
      includeDebug: opts.includeDebug ?? false,
      debugExtra: {
        stage: "router_fallback",
        router: router.out,
        ft_rows: ftRows,
        fs_call: fsCallRaw,
      },
    });
  }

  // ----- Stage 3: synthesizer (no tools) -----
  const synth = await callSynthesizer({
    model,
    question: opts.question,
    evidence,
    extraInstructions,
  });

  // Validate supporting_source_ids
  const validIds = new Set(evidence.map((e) => e.source_id));
  const citedIds = (synth.out.supporting_source_ids ?? []).filter((id) => validIds.has(id));
  const allCitedValid =
    synth.out.supporting_source_ids.length > 0 &&
    citedIds.length === synth.out.supporting_source_ids.length;

  if (!synth.out.answerable || !synth.out.answer.trim() || !allCitedValid) {
    return await finalizeFallback({
      student,
      bootcampId: opts.bootcampId,
      question: opts.question,
      fallback,
      externalMessageId: opts.externalMessageId ?? null,
      log,
      includeDebug: opts.includeDebug ?? false,
      debugExtra: {
        stage: "synth_rejected",
        router: router.out,
        synth: synth.out,
        ft_rows: ftRows,
        fs_call: fsCallRaw,
        evidence,
      },
    });
  }

  // Build source_lessons from cited evidence
  const sourceLessonMap = new Map<string, string>();
  for (const id of citedIds) {
    const e = evidence.find((x) => x.source_id === id);
    if (e) sourceLessonMap.set(e.lesson_id, e.lesson_title);
  }
  const sourceLessons = Array.from(sourceLessonMap, ([lesson_id, lesson_title]) => ({
    lesson_id,
    lesson_title,
  }));

  // Method derivation: based on the layers of cited evidence
  const citedLayers = new Set(
    citedIds.map((id) => evidence.find((e) => e.source_id === id)?.layer).filter(Boolean) as (
      | "full_text"
      | "file_search"
    )[],
  );
  let method: RetrievalMethod = "fallback";
  if (citedLayers.has("full_text") && citedLayers.has("file_search")) method = "combined";
  else if (citedLayers.has("file_search")) method = "file_search";
  else if (citedLayers.has("full_text")) method = "full_text";

  let finalAnswer = synth.out.answer.trim();
  const maxLen = settings?.max_answer_length ?? 600;
  if (finalAnswer.length > maxLen + 200) finalAnswer = finalAnswer.slice(0, maxLen + 200);
  const confidence = Number(CONFIDENCE_NUM[synth.out.confidence].toFixed(3));

  // Log
  let questionId: string | null = null;
  if (log) {
    const { data: logged } = await supabaseAdmin
      .from("questions")
      .insert({
        bootcamp_id: opts.bootcampId,
        student_id: student.id,
        question_text: opts.question,
        ai_answer: finalAnswer,
        confidence_score: confidence,
        retrieval_method: method,
        full_text_results: toJson(ftRows),
        file_search_used: !!fsCallRaw,
        file_search_results: toJson(fsCallRaw ? envelopeFileSearchCall(fsCallRaw)?.results ?? null : null),
        source_lessons: toJson(sourceLessons),
        referenced_lessons: sourceLessons.map((s) => s.lesson_id),
        openai_response_id: synth.raw.id,
        external_message_id: opts.externalMessageId ?? null,
        review_status: "unreviewed",
      })
      .select("id")
      .single();

    questionId = logged?.id ?? null;
    await supabaseAdmin
      .from("students")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", student.id);
  }

  const result: AskResult = {
    question_id: questionId,
    answer: finalAnswer,
    confidence,
    retrieval_method: method,
    source_lessons: sourceLessons,
    student: { first_name: student.first_name, last_name: student.last_name },
  };
  if (opts.includeDebug) {
    result.debug = toJson({
      stage: "answered",
      router: router.out,
      synth: synth.out,
      ft_rows: ftRows,
      fs_call: fsCallRaw,
      evidence,
      cited_ids: citedIds,
    });
  }
  return result;
}

// ---------- Fallback writer ----------

async function finalizeFallback(args: {
  student: { id: string; first_name: string | null; last_name: string | null };
  bootcampId: string;
  question: string;
  fallback: string;
  externalMessageId: string | null;
  log: boolean;
  includeDebug: boolean;
  debugExtra: JsonVal;
}): Promise<AskResult> {
  let questionId: string | null = null;
  if (args.log) {
    const { data: logged } = await supabaseAdmin
      .from("questions")
      .insert({
        bootcamp_id: args.bootcampId,
        student_id: args.student.id,
        question_text: args.question,
        ai_answer: args.fallback,
        confidence_score: 0,
        retrieval_method: "fallback",
        full_text_results: null,
        file_search_used: false,
        file_search_results: null,
        source_lessons: toJson([]),
        referenced_lessons: [],
        external_message_id: args.externalMessageId,
        review_status: "unresolved",
      })
      .select("id")
      .single();
    questionId = logged?.id ?? null;
  }
  const r: AskResult = {
    question_id: questionId,
    answer: args.fallback,
    confidence: 0,
    retrieval_method: "fallback",
    source_lessons: [],
    student: { first_name: args.student.first_name, last_name: args.student.last_name },
  };
  if (args.includeDebug) r.debug = args.debugExtra;
  return r;
}
