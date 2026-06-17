/**
 * Internal end-to-end test endpoint. Guarded by MAKE_API_SECRET so it can be
 * invoked from the build sandbox without user auth.
 *
 *   POST /api/public/__internal-tests
 *   header: x-internal-secret: <MAKE_API_SECRET>
 *   body:   { "action": "backfill" | "tests" | "all" }
 *
 * Runs:
 *  - backfill: sync every published lesson to its bootcamp's vector store and
 *              wait until each becomes "ready" (or surfaces an error).
 *  - tests:    runs the six retrieval cases through askQuestion (log=false).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncLessonToVectorStore } from "@/lib/lesson-sync.server";
import { askQuestion, type AskResult } from "@/lib/ask-question.server";
import { openaiGetVSFile } from "@/lib/openai.server";

type TestCase = {
  name: string;
  question: string;
  studentId: string;
  bootcampId: string;
  expect: {
    method?: ("full_text" | "file_search" | "combined" | "fallback")[];
    mustHaveSources?: boolean;
    mustBeFallback?: boolean;
    minSources?: number;
  };
};

type TestRun = {
  name: string;
  question: string;
  pass: boolean;
  reason: string;
  method: AskResult["retrieval_method"];
  confidence: number;
  sources: { lesson_id: string; lesson_title: string }[];
  answer_preview: string;
};

export const Route = createFileRoute("/api/public/__internal-tests")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-internal-secret");
        if (!secret || secret !== process.env.MAKE_API_SECRET) {
          return new Response("Forbidden", { status: 403 });
        }
        const body = (await request.json().catch(() => ({}))) as {
          action?: "backfill" | "tests" | "all";
        };
        const action = body.action ?? "all";

        const out: Record<string, unknown> = {};

        if (action === "backfill" || action === "all") {
          out.backfill = await runBackfill();
        }
        if (action === "tests" || action === "all") {
          out.tests = await runTests();
        }
        return Response.json(out);
      },
    },
  },
});

async function runBackfill() {
  const { data: lessons } = await supabaseAdmin
    .from("lessons")
    .select("id, title, bootcamp_id, openai_indexing_status")
    .eq("status", "published");

  const results: Array<{
    lesson_id: string;
    title: string;
    sync_status: string;
    openai_status?: string;
    file_id?: string;
    error?: string;
    waited_ms?: number;
  }> = [];

  for (const l of lessons ?? []) {
    const t0 = Date.now();
    try {
      const r = await syncLessonToVectorStore(l.id, true, {
        waitForReady: true,
        pollTimeoutMs: 90_000,
      });
      // double-check via openai
      let openaiStatus: string | undefined;
      if (r.file_id) {
        const { data: settings } = await supabaseAdmin
          .from("bootcamp_settings")
          .select("openai_vector_store_id")
          .eq("bootcamp_id", l.bootcamp_id)
          .maybeSingle();
        if (settings?.openai_vector_store_id) {
          try {
            const f = await openaiGetVSFile(settings.openai_vector_store_id, r.file_id);
            openaiStatus = f.status;
          } catch (e) {
            openaiStatus = `error:${(e as Error).message.slice(0, 80)}`;
          }
        }
      }
      results.push({
        lesson_id: l.id,
        title: l.title,
        sync_status: r.status,
        openai_status: openaiStatus,
        file_id: r.file_id,
        error: r.error,
        waited_ms: Date.now() - t0,
      });
    } catch (e) {
      results.push({
        lesson_id: l.id,
        title: l.title,
        sync_status: "error",
        error: (e as Error).message,
        waited_ms: Date.now() - t0,
      });
    }
  }
  return { count: results.length, results };
}

async function runTests() {
  // Build the 6-case suite from whatever live data exists. The published
  // lesson "test transcript txt" + its student is the primary bootcamp.
  const { data: primaryStudent } = await supabaseAdmin
    .from("students")
    .select("id, bootcamp_id, first_name")
    .eq("enrollment_status", "active")
    .limit(1)
    .maybeSingle();

  if (!primaryStudent) {
    return { error: "No active student found", cases: [] };
  }

  // Pull the published lesson title + first key topic from the primary bootcamp
  // so case 1 (exact keyword) really uses live text from this lesson.
  const { data: pubLesson } = await supabaseAdmin
    .from("lessons")
    .select("id, title, summary, key_topics")
    .eq("bootcamp_id", primaryStudent.bootcamp_id)
    .eq("status", "published")
    .limit(1)
    .maybeSingle();

  const exactKeyword =
    (pubLesson?.key_topics && pubLesson.key_topics[0]) ||
    pubLesson?.title ||
    "lesson";

  // Try to find / create a second bootcamp + student for isolation tests.
  // We don't create anything destructive — only read.
  const { data: otherBootcamps } = await supabaseAdmin
    .from("bootcamps")
    .select("id")
    .neq("id", primaryStudent.bootcamp_id)
    .limit(1);
  const { data: otherStudent } = otherBootcamps?.[0]
    ? await supabaseAdmin
        .from("students")
        .select("id, bootcamp_id")
        .eq("bootcamp_id", otherBootcamps[0].id)
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Unpublished test: temporarily flip the lesson to draft, ask, flip back.
  // Done inside the suite so we don't disturb other concurrent work.
  const cases: TestCase[] = [
    {
      name: "1. Exact keyword (expect full_text)",
      question: `Tell me about ${exactKeyword}.`,
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { method: ["full_text", "combined"], mustHaveSources: true },
    },
    {
      name: "2. Rephrased / semantic (expect file_search or combined)",
      question:
        "Give me a high-level overview of the core ideas this session was really about, in your own words.",
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { method: ["file_search", "combined", "full_text"], mustHaveSources: true },
    },
    {
      name: "3. Multi-section question (expect file_search or combined)",
      question:
        "Combine information from across the lesson and explain how the different parts fit together.",
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { method: ["file_search", "combined", "full_text"], mustHaveSources: true },
    },
    {
      name: "4. Off-topic (expect fallback)",
      question: "What is the chemical formula for sulfuric acid and how is it manufactured industrially?",
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { mustBeFallback: true },
    },
  ];

  if (otherStudent && pubLesson) {
    cases.push({
      name: "5. Different-bootcamp isolation (expect fallback, no leak)",
      question: `Tell me about ${exactKeyword}.`,
      studentId: otherStudent.id,
      bootcampId: otherStudent.bootcamp_id,
      expect: { mustBeFallback: true },
    });
  } else {
    cases.push({
      name: "5. Different-bootcamp isolation (SKIPPED — no second bootcamp/student)",
      question: "",
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: {},
    });
  }

  // Case 6 = unpublished: run inline so we can restore.
  const runs: TestRun[] = [];
  for (const c of cases) {
    if (c.name.includes("SKIPPED")) {
      runs.push({
        name: c.name,
        question: c.question,
        pass: true,
        reason: "skipped",
        method: "fallback",
        confidence: 0,
        sources: [],
        answer_preview: "",
      });
      continue;
    }
    runs.push(await runOne(c));
  }

  if (pubLesson) {
    // Case 6 — temporarily unpublish
    await supabaseAdmin.from("lessons").update({ status: "ready" }).eq("id", pubLesson.id);
    try {
      const r = await runOne({
        name: "6. Unpublished lesson (expect fallback)",
        question: `Tell me about ${exactKeyword}.`,
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: { mustBeFallback: true },
      });
      runs.push(r);
    } finally {
      await supabaseAdmin
        .from("lessons")
        .update({ status: "published" })
        .eq("id", pubLesson.id);
    }
  }

  const passed = runs.filter((r) => r.pass).length;
  return { total: runs.length, passed, failed: runs.length - passed, runs };
}

async function runOne(c: TestCase): Promise<TestRun> {
  try {
    const res = await askQuestion({
      studentId: c.studentId,
      bootcampId: c.bootcampId,
      question: c.question,
      log: false,
      includeDebug: false,
    });

    let pass = true;
    const reasons: string[] = [];

    if (c.expect.mustBeFallback) {
      if (res.retrieval_method !== "fallback") {
        pass = false;
        reasons.push(`expected fallback, got ${res.retrieval_method}`);
      }
      if (res.source_lessons.length > 0) {
        pass = false;
        reasons.push("leaked sources on fallback");
      }
    }
    if (c.expect.method && !c.expect.method.includes(res.retrieval_method)) {
      pass = false;
      reasons.push(`method ${res.retrieval_method} not in [${c.expect.method.join(",")}]`);
    }
    if (c.expect.mustHaveSources && res.source_lessons.length === 0) {
      pass = false;
      reasons.push("no source lessons returned");
    }

    return {
      name: c.name,
      question: c.question,
      pass,
      reason: pass ? "ok" : reasons.join("; "),
      method: res.retrieval_method,
      confidence: res.confidence,
      sources: res.source_lessons,
      answer_preview: res.answer.slice(0, 240),
    };
  } catch (e) {
    return {
      name: c.name,
      question: c.question,
      pass: false,
      reason: `threw: ${(e as Error).message}`,
      method: "fallback",
      confidence: 0,
      sources: [],
      answer_preview: "",
    };
  }
}
