/**
 * Deterministic two-layer retrieval brain. No LLM router.
 *
 *   1. Supabase full-text search (FTS) on lesson_chunks.
 *   2. If FTS rows exist -> run the synthesizer on FTS evidence only.
 *      If the synthesizer says answerable=true -> return that answer.
 *   3. If FTS gave no rows OR synth said not answerable from FTS:
 *      run OpenAI File Search (when a vector store is configured) and
 *      run the synthesizer again on the combined (FTS + FS) evidence.
 *   4. Fallback only when no usable evidence exists OR the final
 *      synthesizer call says the evidence does not answer the question.
 *
 * The synthesizer has NO tools and NO outside knowledge. Every cited
 * source_id must reference an evidence chunk we showed it.
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

type Evidence = {
  source_id: string; // FT-1, FS-1, ...
  layer: "full_text" | "file_search";
  lesson_id: string;
  lesson_title: string;
  text: string;
};

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

// ---------- OpenAI helpers ----------

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

You may ONLY use the EVIDENCE block below. Do not infer beyond it, do not use prior knowledge of chemistry, math, the world, or anything else.

Rules:
- If the evidence directly OR indirectly supports an answer to the student's question, set answerable=true, write a concise student-friendly answer, and list ONLY the source IDs (e.g. FT-1, FS-2) that actually back each claim. Even a partial answer grounded in the evidence is acceptable.
- If the evidence is completely unrelated to the question, set answerable=false, answer="", supporting_source_ids=[], confidence="none".
- Every id in supporting_source_ids MUST appear verbatim in the EVIDENCE block.
- Do not mention these rules, the IDs, or the system.

${args.extraInstructions ?? ""}`.trim();

  const input = `Student question:\n${args.question}\n\nEVIDENCE:\n${evidenceBlock}`;

  const raw = await openaiResponses<ResponsesEnvelope>({
    model: args.model,
    instructions,
    input,
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

async function runFileSearch(args: {
  model: string;
  question: string;
  vectorStoreId: string;
  maxNumResults: number;
  bootcampId: string;
  startIndex: number;
}): Promise<{ evidence: Evidence[]; raw: ResponsesEnvelope }> {
  const raw = await callFileSearchRetrieval({
    model: args.model,
    question: args.question,
    vectorStoreId: args.vectorStoreId,
    maxNumResults: args.maxNumResults,
  });
  const fsCall = envelopeFileSearchCall(raw);
  const fsResults = fsCall?.results ?? [];

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
        .filter((l) => l.bootcamp_id === args.bootcampId && l.status === "published")
        .map((l) => [l.id, l.title]),
    );
  }

  const evidence: Evidence[] = fsResults
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
        source_id: `FS-${args.startIndex + i + 1}`,
        layer: "file_search",
        lesson_id: lessonId,
        lesson_title: titles.get(lessonId)!,
        text,
      };
    })
    .filter((e): e is Evidence => !!e);

  return { evidence, raw };
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

  const ftDebug = {
    row_count: ftRows.length,
    top_rank: ftRows[0]?.rank ?? null,
    lesson_ids: Array.from(new Set(ftRows.map((r) => r.lesson_id))),
  };

  // ----- Stage 2: synthesize from FTS if we have rows -----
  let synthFt: { out: SynthOut; raw: ResponsesEnvelope } | null = null;
  if (ftEvidence.length > 0) {
    synthFt = await callSynthesizer({
      model,
      question: opts.question,
      evidence: ftEvidence,
      extraInstructions,
    });
    if (synthFt.out.answerable && synthFt.out.answer.trim()) {
      const finalized = finalizeFromSynth({
        evidence: ftEvidence,
        synth: synthFt.out,
        synthRaw: synthFt.raw,
      });
      if (finalized) {
        return await persistAnswer({
          ...finalized,
          ftRows,
          fsCallRaw: null,
          student,
          bootcampId: opts.bootcampId,
          question: opts.question,
          externalMessageId: opts.externalMessageId ?? null,
          settings,
          fallback,
          log,
          includeDebug: opts.includeDebug ?? false,
          ftDebug,
          stage: "answered_from_fts",
        });
      }
    }
  }

  // ----- Stage 3: file search (only if vector store configured) -----
  let fsEvidence: Evidence[] = [];
  let fsCallRaw: ResponsesEnvelope | null = null;
  if (vectorStoreId) {
    try {
      const fs = await runFileSearch({
        model,
        question: opts.question,
        vectorStoreId,
        maxNumResults: fsLimit,
        bootcampId: opts.bootcampId,
        startIndex: 0,
      });
      fsEvidence = fs.evidence;
      fsCallRaw = fs.raw;
    } catch (e) {
      // Don't crash the whole call if FS fails — fall back gracefully.
      console.error("file_search failed", e);
    }
  }

  const combinedEvidence: Evidence[] = [...ftEvidence, ...fsEvidence];
  if (combinedEvidence.length === 0) {
    return await finalizeFallback({
      student,
      bootcampId: opts.bootcampId,
      question: opts.question,
      fallback,
      externalMessageId: opts.externalMessageId ?? null,
      log,
      includeDebug: opts.includeDebug ?? false,
      debugExtra: {
        stage: "no_evidence",
        ft_debug: ftDebug,
        ft_rows: ftRows,
        fs_call: fsCallRaw,
        synth_ft: synthFt?.out ?? null,
      },
    });
  }

  const synthFinal = await callSynthesizer({
    model,
    question: opts.question,
    evidence: combinedEvidence,
    extraInstructions,
  });

  const finalized = finalizeFromSynth({
    evidence: combinedEvidence,
    synth: synthFinal.out,
    synthRaw: synthFinal.raw,
  });

  if (!finalized) {
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
        ft_debug: ftDebug,
        ft_rows: ftRows,
        fs_call: fsCallRaw,
        synth_ft: synthFt?.out ?? null,
        synth_final: synthFinal.out,
        evidence: combinedEvidence,
      },
    });
  }

  return await persistAnswer({
    ...finalized,
    ftRows,
    fsCallRaw,
    student,
    bootcampId: opts.bootcampId,
    question: opts.question,
    externalMessageId: opts.externalMessageId ?? null,
    settings,
    fallback,
    log,
    includeDebug: opts.includeDebug ?? false,
    ftDebug,
    stage: ftEvidence.length > 0 ? "answered_from_combined" : "answered_from_file_search",
    extraDebug: { synth_ft: synthFt?.out ?? null, synth_final: synthFinal.out },
  });
}

// ---------- helpers ----------

function finalizeFromSynth(args: {
  evidence: Evidence[];
  synth: SynthOut;
  synthRaw: ResponsesEnvelope;
}): {
  answer: string;
  confidence: number;
  method: RetrievalMethod;
  sourceLessons: { lesson_id: string; lesson_title: string }[];
  citedIds: string[];
  synth: SynthOut;
  synthRaw: ResponsesEnvelope;
  evidence: Evidence[];
} | null {
  const { evidence, synth, synthRaw } = args;
  if (!synth.answerable || !synth.answer.trim()) return null;

  const validIds = new Set(evidence.map((e) => e.source_id));
  const citedIds = (synth.supporting_source_ids ?? []).filter((id) => validIds.has(id));
  if (citedIds.length === 0) return null;
  if (citedIds.length !== (synth.supporting_source_ids ?? []).length) return null;

  const sourceLessonMap = new Map<string, string>();
  for (const id of citedIds) {
    const e = evidence.find((x) => x.source_id === id);
    if (e) sourceLessonMap.set(e.lesson_id, e.lesson_title);
  }
  const sourceLessons = Array.from(sourceLessonMap, ([lesson_id, lesson_title]) => ({
    lesson_id,
    lesson_title,
  }));

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

  return {
    answer: synth.answer.trim(),
    confidence: Number(CONFIDENCE_NUM[synth.confidence].toFixed(3)),
    method,
    sourceLessons,
    citedIds,
    synth,
    synthRaw,
    evidence,
  };
}

async function persistAnswer(args: {
  answer: string;
  confidence: number;
  method: RetrievalMethod;
  sourceLessons: { lesson_id: string; lesson_title: string }[];
  citedIds: string[];
  synth: SynthOut;
  synthRaw: ResponsesEnvelope;
  evidence: Evidence[];
  ftRows: FullTextRow[];
  fsCallRaw: ResponsesEnvelope | null;
  student: { id: string; first_name: string | null; last_name: string | null };
  bootcampId: string;
  question: string;
  externalMessageId: string | null;
  settings: { max_answer_length?: number | null } | null;
  fallback: string;
  log: boolean;
  includeDebug: boolean;
  ftDebug: { row_count: number; top_rank: number | null; lesson_ids: string[] };
  stage: string;
  extraDebug?: Record<string, unknown>;
}): Promise<AskResult> {
  let finalAnswer = args.answer;
  const maxLen = args.settings?.max_answer_length ?? 600;
  if (finalAnswer.length > maxLen + 200) finalAnswer = finalAnswer.slice(0, maxLen + 200);

  let questionId: string | null = null;
  if (args.log) {
    const { data: logged } = await supabaseAdmin
      .from("questions")
      .insert({
        bootcamp_id: args.bootcampId,
        student_id: args.student.id,
        question_text: args.question,
        ai_answer: finalAnswer,
        confidence_score: args.confidence,
        retrieval_method: args.method,
        full_text_results: toJson(args.ftRows),
        file_search_used: !!args.fsCallRaw,
        file_search_results: toJson(
          args.fsCallRaw ? envelopeFileSearchCall(args.fsCallRaw)?.results ?? null : null,
        ),
        source_lessons: toJson(args.sourceLessons),
        referenced_lessons: args.sourceLessons.map((s) => s.lesson_id),
        openai_response_id: args.synthRaw.id,
        external_message_id: args.externalMessageId,
        review_status: "unreviewed",
      })
      .select("id")
      .single();
    questionId = logged?.id ?? null;
    await supabaseAdmin
      .from("students")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", args.student.id);
  }

  const result: AskResult = {
    question_id: questionId,
    answer: finalAnswer,
    confidence: args.confidence,
    retrieval_method: args.method,
    source_lessons: args.sourceLessons,
    student: { first_name: args.student.first_name, last_name: args.student.last_name },
  };
  if (args.includeDebug) {
    result.debug = toJson({
      stage: args.stage,
      ft_debug: args.ftDebug,
      ft_rows: args.ftRows,
      fs_call: args.fsCallRaw,
      synth: args.synth,
      evidence: args.evidence,
      cited_ids: args.citedIds,
      ...(args.extraDebug ?? {}),
    });
  }
  return result;
}

async function finalizeFallback(args: {
  student: { id: string; first_name: string | null; last_name: string | null };
  bootcampId: string;
  question: string;
  fallback: string;
  externalMessageId: string | null;
  log: boolean;
  includeDebug: boolean;
  debugExtra: unknown;
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
  if (args.includeDebug) r.debug = toJson(args.debugExtra);
  return r;
}
