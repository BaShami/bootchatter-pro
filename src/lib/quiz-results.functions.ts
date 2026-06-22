import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ lesson_id: z.string().uuid() });

type QuizQuestion = { question: string; options: string[]; correct: string };
type QuizAnswer = { question_index: number; answer: string; correct: boolean };

export type LessonQuizResults = {
  questions: QuizQuestion[];
  perQuestionCorrectPct: number[];
  sessions: {
    id: string;
    studentName: string;
    score: number;
    total: number;
    results: (boolean | null)[]; // per-question correct/incorrect
    completedAt: string;
  }[];
  attempted: number;
  averageScore: number | null;
  struggling: number;
  insight: string | null;
};

export const getLessonQuizResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<LessonQuizResults> => {
    const { supabase } = context;

    const { data: sessions, error } = await supabase
      .from("quiz_sessions")
      .select("id, student_id, questions, answers, score, updated_at, created_at")
      .eq("lesson_id", data.lesson_id)
      .eq("status", "completed")
      .order("score", { ascending: true });
    if (error) throw new Error(error.message);

    const rows = sessions ?? [];
    const studentIds = Array.from(new Set(rows.map((r) => r.student_id)));
    const nameMap = new Map<string, string>();
    if (studentIds.length > 0) {
      const { data: studs } = await supabase
        .from("students")
        .select("id, first_name, last_name")
        .in("id", studentIds);
      for (const s of studs ?? []) {
        nameMap.set(
          s.id,
          [s.first_name, s.last_name].filter(Boolean).join(" ") || "Student",
        );
      }
    }

    // Use the first session's questions as the canonical list.
    const firstQs = (rows[0]?.questions as QuizQuestion[] | undefined) ?? [];
    const total = firstQs.length;

    const correctCounts = new Array(total).fill(0);
    const answeredCounts = new Array(total).fill(0);

    const sessionRows: LessonQuizResults["sessions"] = rows.map((r) => {
      const answers = (r.answers ?? []) as QuizAnswer[];
      const results: (boolean | null)[] = new Array(total).fill(null);
      for (const a of answers) {
        if (a.question_index >= 0 && a.question_index < total) {
          results[a.question_index] = a.correct;
          answeredCounts[a.question_index] += 1;
          if (a.correct) correctCounts[a.question_index] += 1;
        }
      }
      return {
        id: r.id,
        studentName: nameMap.get(r.student_id) ?? "Student",
        score: r.score ?? 0,
        total,
        results,
        completedAt: r.updated_at ?? r.created_at,
      };
    });

    const perQuestionCorrectPct = correctCounts.map((c, i) =>
      answeredCounts[i] > 0 ? Math.round((c / answeredCounts[i]) * 100) : 0,
    );

    const attempted = rows.length;
    const averageScore =
      attempted > 0
        ? rows.reduce((sum, r) => sum + (r.score ?? 0), 0) / attempted
        : null;
    const struggling = rows.filter((r) => (r.score ?? 0) < 2).length;

    let insight: string | null = null;
    if (attempted > 0 && total > 0 && process.env.OPENAI_API_KEY) {
      try {
        const { openaiChat } = await import("@/lib/openai.server");
        const summary = firstQs
          .map(
            (q, i) =>
              `Q${i + 1}: "${q.question}" — ${perQuestionCorrectPct[i]}% correct`,
          )
          .join("\n");
        const text = await openaiChat({
          system:
            "You are a teaching assistant. Given quiz stats, write ONE concise sentence (max 25 words) telling the instructor which concept students are struggling with most. No preamble.",
          user: `Quiz results across ${attempted} students:\n${summary}\n\nWrite one sentence.`,
          max_tokens: 80,
          temperature: 0.3,
        });
        insight = text.trim().replace(/^["']|["']$/g, "") || null;
      } catch (e) {
        console.warn("[quiz-results] insight generation failed", e);
      }
    }

    return {
      questions: firstQs,
      perQuestionCorrectPct,
      sessions: sessionRows,
      attempted,
      averageScore,
      struggling,
      insight,
    };
  });
