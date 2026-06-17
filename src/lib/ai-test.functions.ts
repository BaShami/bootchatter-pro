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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AuthedSupabase = SupabaseClient<Database>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeAnchor = createClient;

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
  supabase: AuthedSupabase,
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
        name: "1. Exact keyword (any grounded retrieval)",
        question: `Tell me about ${exactKeyword}.`,
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: {
          method: ["full_text", "file_search", "combined"],
          mustHaveSources: true,
        },
      },
      {
        name: "2. Rephrased / semantic",
        question:
          "Give me a high-level overview of the core ideas this session was really about, in your own words.",
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: {
          method: ["full_text", "file_search", "combined"],
          mustHaveSources: true,
        },
      },
      {
        name: "3. Multi-section",
        question:
          "What did the participants say about workflows and AI agents during this session?",
        studentId: primaryStudent.id,
        bootcampId: primaryStudent.bootcamp_id,
        expect: {
          method: ["full_text", "file_search", "combined"],
          mustHaveSources: true,
        },
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

    // ----- Test 5: isolation. Create a temporary 2nd bootcamp + student. -----
    const isoBootcampName = `__test_isolation_${Date.now()}`;
    const isoBootcampInsert = await supabaseAdmin
      .from("bootcamps")
      .insert({ name: isoBootcampName, created_by: context.userId })
      .select("id")
      .single();
    const isoBootcampId = isoBootcampInsert.data?.id ?? null;
    let isoStudentId: string | null = null;
    if (isoBootcampId) {
      const isoStudent = await supabaseAdmin
        .from("students")
        .insert({
          bootcamp_id: isoBootcampId,
          first_name: "Iso",
          last_name: "Test",
          phone_number: `+1555${Date.now().toString().slice(-7)}`,
          enrollment_status: "active",
        })
        .select("id")
        .single();
      isoStudentId = isoStudent.data?.id ?? null;
    }

    if (isoStudentId && isoBootcampId) {
      try {
        runs.push(
          await runOne(
            {
              name: "5. Different bootcamp isolation → fallback",
              question: `Tell me about ${exactKeyword}.`,
              studentId: isoStudentId,
              bootcampId: isoBootcampId,
              expect: { mustBeFallback: true },
            },
            askQuestion,
          ),
        );
      } finally {
        await supabaseAdmin.from("students").delete().eq("id", isoStudentId);
        await supabaseAdmin.from("bootcamps").delete().eq("id", isoBootcampId);
      }
    } else {
      runs.push({
        name: "5. Different bootcamp isolation (FAILED to provision temp bootcamp)",
        question: "",
        pass: false,
        reason: "could not create temporary bootcamp/student",
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

/**
 * Direct parser unit test. Feeds the exact OpenAI envelope shape we observed
 * in production (where every result carries `text` at the top level, not
 * inside `content[].text`) into the pure parser. Catches the bug where the
 * parser only reads `content[].text` and silently discards every FS result.
 */
export const runFileSearchParserTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.supabase, context.userId);
    const { extractEvidenceFromFileSearch } = await import("@/lib/ask-question.server");

    const LESSON_A = "1d1ed7d4-f5bd-4ad6-a668-9defdb5a5015";
    const LESSON_B = "22222222-2222-2222-2222-222222222222";
    const LESSON_FOREIGN = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    const envelope = {
      id: "resp_test",
      output: [
        {
          type: "file_search_call",
          id: "fs1",
          status: "completed",
          results: [
            // top-level text — production shape
            { file_id: "f1", attributes: { lesson_id: LESSON_A, published: true }, text: "AI agents and workflows summary" },
            // duplicate of above — must be deduped
            { file_id: "f1", attributes: { lesson_id: LESSON_A, published: true }, text: "AI agents and workflows summary" },
            // empty text — must be skipped
            { file_id: "f1", attributes: { lesson_id: LESSON_A, published: true }, text: "" },
            // foreign bootcamp lesson — must be skipped
            { file_id: "f9", attributes: { lesson_id: LESSON_FOREIGN, published: true }, text: "should not appear" },
            // no lesson_id — must be skipped
            { file_id: "f0", attributes: { published: true }, text: "no lesson id" },
          ],
        },
        // SECOND file_search_call — must also be walked
        {
          type: "file_search_call",
          id: "fs2",
          status: "completed",
          results: [
            // legacy content[].text shape — fallback path
            {
              file_id: "f2",
              attributes: { lesson_id: LESSON_B, published: true },
              content: [{ type: "output_text", text: "Lesson B content via content[]" }],
            },
          ],
        },
      ],
    } as const;

    const allowed = new Map<string, string>([
      [LESSON_A, "Lesson A"],
      [LESSON_B, "Lesson B"],
    ]);

    const { evidence, rawCount, lessonIdsSeen } = extractEvidenceFromFileSearch({
      envelope: envelope as Parameters<typeof extractEvidenceFromFileSearch>[0]["envelope"],
      allowedLessonTitles: allowed,
      startIndex: 0,
    });

    const checks: Array<{ name: string; pass: boolean; got: unknown; want: unknown }> = [
      { name: "walks both file_search_call items (rawCount)", pass: rawCount === 6, got: rawCount, want: 6 },
      { name: "sees foreign lesson in lessonIdsSeen", pass: lessonIdsSeen.includes(LESSON_FOREIGN), got: lessonIdsSeen, want: "includes foreign" },
      { name: "emits exactly 2 evidence items", pass: evidence.length === 2, got: evidence.length, want: 2 },
      { name: "uses top-level text from result 1", pass: evidence[0]?.text === "AI agents and workflows summary", got: evidence[0]?.text, want: "AI agents and workflows summary" },
      { name: "falls back to content[].text for legacy shape", pass: evidence[1]?.text === "Lesson B content via content[]", got: evidence[1]?.text, want: "Lesson B content via content[]" },
      { name: "drops foreign-bootcamp lesson", pass: !evidence.some((e) => e.lesson_id === LESSON_FOREIGN), got: evidence.map((e) => e.lesson_id), want: "no foreign id" },
      { name: "dedupes identical (lesson_id, text)", pass: evidence.filter((e) => e.lesson_id === LESSON_A).length === 1, got: evidence.filter((e) => e.lesson_id === LESSON_A).length, want: 1 },
      { name: "skips empty text", pass: evidence.every((e) => e.text.length > 0), got: "ok", want: "ok" },
      { name: "source_ids are FS-1, FS-2", pass: evidence.map((e) => e.source_id).join(",") === "FS-1,FS-2", got: evidence.map((e) => e.source_id), want: ["FS-1", "FS-2"] },
    ];

    const passed = checks.filter((c) => c.pass).length;
    return {
      total: checks.length,
      passed,
      failed: checks.length - passed,
      checks,
      evidence,
    };
  });
