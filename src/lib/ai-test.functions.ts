/**
 * Admin tester for the AI brain. Uses the SAME askQuestion function as the
 * public Make.com endpoint, but does not log to the questions table and
 * returns full debug. Admin-only (bootcamp admin of the student's bootcamp).
 *
 * Also exposes:
 *  - backfillPublishedLessons: re-syncs every published lesson to its
 *    bootcamp's OpenAI vector store, waiting for "ready".
 *  - runRetrievalTestSuite: runs the 6 canonical retrieval cases against the
 *    live brain without writing to questions table; returns PASS/FAIL per case.
 *
 * Both admin functions require platform_admin (since they touch every bootcamp).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AskInput = z.object({
  student_id: z.string().uuid(),
  question: z.string().trim().min(2).max(2000),
});

export const testAskQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AskInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: student } = await supabase
      .from("students")
      .select("id, bootcamp_id")
      .eq("id", data.student_id)
      .maybeSingle();
    if (!student) throw new Error("Student not found");

    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: student.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { askQuestion } = await import("@/lib/ask-question.server");
    return askQuestion({
      studentId: student.id,
      bootcampId: student.bootcamp_id,
      question: data.question,
      log: false,
      includeDebug: true,
    });
  });

async function requirePlatformAdmin(
  supabase: import("@/integrations/supabase/auth-middleware").AuthedSupabase,
  userId: string,
) {
  const { data } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "platform_admin",
  });
  if (!data) throw new Error("Forbidden: platform admin required");
}

export const backfillPublishedLessons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncLessonToVectorStore } = await import("@/lib/lesson-sync.server");
    const { openaiGetVSFile } = await import("@/lib/openai.server");

    const { data: lessons } = await supabaseAdmin
      .from("lessons")
      .select("id, title, bootcamp_id")
      .eq("status", "published");

    const results: Array<{
      lesson_id: string;
      title: string;
      sync_status: string;
      openai_status?: string;
      file_id?: string;
      error?: string;
      waited_ms: number;
    }> = [];

    for (const l of lessons ?? []) {
      const t0 = Date.now();
      try {
        const r = await syncLessonToVectorStore(l.id, true, {
          waitForReady: true,
          pollTimeoutMs: 120_000,
        });
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
              openaiStatus = `err:${(e as Error).message.slice(0, 60)}`;
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
  });

type Method = "full_text" | "file_search" | "combined" | "fallback";
type TestCase = {
  name: string;
  question: string;
  studentId: string;
  bootcampId: string;
  expect: {
    method?: Method[];
    mustHaveSources?: boolean;
    mustBeFallback?: boolean;
  };
};
type TestRun = {
  name: string;
  question: string;
  pass: boolean;
  reason: string;
  method: Method;
  confidence: number;
  sources: { lesson_id: string; lesson_title: string }[];
  answer_preview: string;
};

export const runRetrievalTestSuite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { askQuestion } = await import("@/lib/ask-question.server");

    const { data: primaryStudent } = await supabaseAdmin
      .from("students")
      .select("id, bootcamp_id")
      .eq("enrollment_status", "active")
      .limit(1)
      .maybeSingle();
    if (!primaryStudent) return { error: "No active student found", runs: [] };

    const { data: pubLesson } = await supabaseAdmin
      .from("lessons")
      .select("id, title, key_topics")
      .eq("bootcamp_id", primaryStudent.bootcamp_id)
      .eq("status", "published")
      .limit(1)
      .maybeSingle();

    const exactKeyword =
      (pubLesson?.key_topics && pubLesson.key_topics[0]) ||
      pubLesson?.title ||
      "lesson";

    const { data: otherBcs } = await supabaseAdmin
      .from("bootcamps")
      .select("id")
      .neq("id", primaryStudent.bootcamp_id)
      .limit(1);
    const otherStudentRes = otherBcs?.[0]
      ? await supabaseAdmin
          .from("students")
          .select("id, bootcamp_id")
          .eq("bootcamp_id", otherBcs[0].id)
          .limit(1)
          .maybeSingle()
      : { data: null as { id: string; bootcamp_id: string } | null };
    const otherStudent = otherStudentRes.data;

    const cases: TestCase[] = [
      {
        name: "1. Exact keyword → full_text",
        question: `Tell me about ${exactKeyword}.`,
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: { method: ["full_text", "combined"], mustHaveSources: true },
      },
      {
        name: "2. Rephrased / semantic → file_search or combined",
        question:
          "Give me a high-level overview of the core ideas this session was really about, in your own words.",
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: { method: ["file_search", "combined", "full_text"], mustHaveSources: true },
      },
      {
        name: "3. Multi-section → file_search or combined",
        question:
          "Combine information from across the lesson and explain how the different parts fit together.",
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: { method: ["file_search", "combined", "full_text"], mustHaveSources: true },
      },
      {
        name: "4. Off-topic → fallback",
        question:
          "What is the chemical formula for sulfuric acid and how is it manufactured industrially?",
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: { mustBeFallback: true },
      },
    ];

    const runs: TestRun[] = [];
    for (const c of cases) runs.push(await runOne(c, askQuestion));

    if (otherStudent && pubLesson) {
      runs.push(
        await runOne(
          {
            name: "5. Different bootcamp isolation → fallback",
            question: `Tell me about ${exactKeyword}.`,
            studentId: otherStudent.id,
            bootcampId: otherStudent.bootcamp_id,
            expect: { mustBeFallback: true },
          },
          askQuestion,
        ),
      );
    } else {
      runs.push({
        name: "5. Different bootcamp isolation (SKIPPED — only one bootcamp/student exists)",
        question: "",
        pass: true,
        reason: "skipped",
        method: "fallback",
        confidence: 0,
        sources: [],
        answer_preview: "",
      });
    }

    if (pubLesson) {
      await supabaseAdmin.from("lessons").update({ status: "ready" }).eq("id", pubLesson.id);
      try {
        runs.push(
          await runOne(
            {
              name: "6. Unpublished lesson → fallback",
              question: `Tell me about ${exactKeyword}.`,
              studentId: primaryStudent.id,
              bootcampId: primaryStudent.bootcamp_id,
              expect: { mustBeFallback: true },
            },
            askQuestion,
          ),
        );
      } finally {
        await supabaseAdmin
          .from("lessons")
          .update({ status: "published" })
          .eq("id", pubLesson.id);
      }
    }

    const passed = runs.filter((r) => r.pass).length;
    return {
      total: runs.length,
      passed,
      failed: runs.length - passed,
      runs,
    };
  });

async function runOne(
  c: TestCase,
  ask: typeof import("@/lib/ask-question.server").askQuestion,
): Promise<TestRun> {
  try {
    const res = await ask({
      studentId: c.studentId,
      bootcampId: c.bootcampId,
      question: c.question,
      log: false,
      includeDebug: false,
    });
    const reasons: string[] = [];
    let pass = true;
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
      reasons.push("no source lessons");
    }
    return {
      name: c.name,
      question: c.question,
      pass,
      reason: pass ? "ok" : reasons.join("; "),
      method: res.retrieval_method,
      confidence: res.confidence,
      sources: res.source_lessons,
      answer_preview: res.answer.slice(0, 220),
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
