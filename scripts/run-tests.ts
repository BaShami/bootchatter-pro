// Internal test runner. Runs the 6-case suite by calling askQuestion directly.
import "dotenv/config";
import { askQuestion } from "../src/lib/ask-question.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

type Method = "full_text" | "file_search" | "combined" | "fallback";

async function main() {
  const { data: primaryStudent } = await supabaseAdmin
    .from("students")
    .select("id, bootcamp_id")
    .eq("enrollment_status", "active")
    .limit(1)
    .maybeSingle();
  if (!primaryStudent) throw new Error("no active student");

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

  type Case = {
    name: string;
    question: string;
    studentId: string;
    bootcampId: string;
    expect: { method?: Method[]; mustHaveSources?: boolean; mustBeFallback?: boolean };
  };

  const runOne = async (c: Case) => {
    try {
      const res = await askQuestion({
        studentId: c.studentId,
        bootcampId: c.bootcampId,
        question: c.question,
        log: false,
        includeDebug: true,
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
      const dbg = res.debug as { stage?: string; ft_debug?: unknown } | undefined;
      return {
        name: c.name,
        question: c.question,
        pass,
        reason: pass ? "ok" : reasons.join("; "),
        method: res.retrieval_method,
        confidence: res.confidence,
        sources: res.source_lessons,
        answer_preview: res.answer.slice(0, 240),
        stage: dbg?.stage,
        ft_debug: dbg?.ft_debug,
      };
    } catch (e) {
      return {
        name: c.name,
        pass: false,
        reason: `threw: ${(e as Error).message}`,
        method: "fallback" as Method,
      };
    }
  };

  const runs: unknown[] = [];

  const cases: Case[] = [
    {
      name: "1. Exact keyword",
      question: `Tell me about ${exactKeyword}.`,
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { method: ["full_text", "file_search", "combined"], mustHaveSources: true },
    },
    {
      name: "2. Rephrased / semantic",
      question:
        "Give me a high-level overview of the core ideas this session was really about, in your own words.",
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { method: ["full_text", "file_search", "combined"], mustHaveSources: true },
    },
    {
      name: "3. Multi-section",
      question:
        "Combine information from across the lesson and explain how the different parts fit together.",
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { method: ["full_text", "file_search", "combined"], mustHaveSources: true },
    },
    {
      name: "4. Off-topic -> fallback",
      question:
        "What is the chemical formula for sulfuric acid and how is it manufactured industrially?",
      studentId: primaryStudent.id,
      bootcampId: primaryStudent.bootcamp_id,
      expect: { mustBeFallback: true },
    },
  ];

  for (const c of cases) runs.push(await runOne(c));

  // 5: isolation
  const isoName = `__test_isolation_${Date.now()}`;
  const { data: bc } = await supabaseAdmin
    .from("bootcamps")
    .insert({ name: isoName, created_by: primaryStudent.id })
    .select("id")
    .single();
  let isoStudentId: string | null = null;
  if (bc?.id) {
    const { data: st } = await supabaseAdmin
      .from("students")
      .insert({
        bootcamp_id: bc.id,
        first_name: "Iso",
        last_name: "Test",
        phone_number: `+1555${Date.now().toString().slice(-7)}`,
        enrollment_status: "active",
      })
      .select("id")
      .single();
    isoStudentId = st?.id ?? null;
  }
  if (bc?.id && isoStudentId) {
    try {
      runs.push(
        await runOne({
          name: "5. Isolation -> fallback",
          question: `Tell me about ${exactKeyword}.`,
          studentId: isoStudentId,
          bootcampId: bc.id,
          expect: { mustBeFallback: true },
        }),
      );
    } finally {
      await supabaseAdmin.from("students").delete().eq("id", isoStudentId);
      await supabaseAdmin.from("bootcamps").delete().eq("id", bc.id);
    }
  }

  // 6: unpublished
  if (pubLesson) {
    await supabaseAdmin.from("lessons").update({ status: "ready" }).eq("id", pubLesson.id);
    try {
      runs.push(
        await runOne({
          name: "6. Unpublished -> fallback",
          question: `Tell me about ${exactKeyword}.`,
          studentId: primaryStudent.id,
          bootcampId: primaryStudent.bootcamp_id,
          expect: { mustBeFallback: true },
        }),
      );
    } finally {
      await supabaseAdmin
        .from("lessons")
        .update({ status: "published" })
        .eq("id", pubLesson.id);
    }
  }

  console.log(JSON.stringify({ total: runs.length, runs }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
