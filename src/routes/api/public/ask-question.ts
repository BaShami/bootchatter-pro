import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  phone_number: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "phone_number must be E.164 format, e.g. +14155551234"),
  question: z.string().trim().min(1).max(2000),
  external_message_id: z.string().trim().max(200).optional(),
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type QuizQuestion = { question: string; options: string[]; correct: string };

function formatQuestion(q: { question: string; options: string[] }, num: number): string {
  return `Question ${num} of 3:\n\n${q.question}\n\n${q.options.join("\n")}\n\nReply A, B or C`;
}

async function generateQuizQuestions(lesson: {
  title: string;
  summary: string | null;
  learning_objectives: string | null;
}): Promise<QuizQuestion[] | null> {
  const { openaiChat } = await import("@/lib/openai.server");
  const raw = await openaiChat({
    system:
      "You generate multiple choice quiz questions for bootcamp students. Respond with strict JSON only, no markdown.",
    user: `Based on this lesson, generate exactly 3 quiz questions as a JSON array. Each object must have: question (string), options (array of exactly 3 strings, each starting with 'A. ', 'B. ', 'C. '), correct (string, either 'A', 'B', or 'C'). Lesson title: ${lesson.title}. Summary: ${lesson.summary ?? ""}. Learning objectives: ${lesson.learning_objectives ?? ""}`,
  });
  try {
    const parsed = JSON.parse(raw) as QuizQuestion[] | { questions: QuizQuestion[] };
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    return questions;
  } catch (e) {
    console.error("[generateQuizQuestions] parse failed:", e);
    return null;
  }
}

function formatQuizResults(
  score: number,
  answers: { question_index: number; correct: boolean }[],
): string {
  const lines = answers.map(
    (a) => `${a.correct ? "✅" : "❌"} Q${a.question_index + 1}`,
  );
  const encouragement =
    score < 2
      ? "We recommend revisiting today's lesson before the next one."
      : "Great work! Keep it up.";
  return `You scored ${score}/3 🎉\n\n${lines.join("\n")}\n\n${encouragement}\n\nAny questions about the lesson? Just ask 👇`;
}

const HUMAN_ESCALATION_PHRASES = [
  "human",
  "support",
  "help",
  "talk to someone",
  "speak to someone",
  "real person",
  "talk to human",
  "talk to a human",
  "speak to instructor",
  "speak to an instructor",
] as const;

function isHumanEscalation(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return (HUMAN_ESCALATION_PHRASES as readonly string[]).includes(lower);
}

function formatKbContext(
  articles: { title: string; tag: string; extracted_text: string | null }[],
): string {
  const sections = articles.map(
    (article) =>
      `[${article.tag.toUpperCase()}] ${article.title}\n${article.extracted_text ?? ""}`,
  );
  return `KNOWLEDGE BASE ARTICLES:\n\n${sections.join("\n\n")}`;
}

// Key: phone_number. Limit: 10 requests / 60 seconds.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitBuckets = new Map<string, number[]>();
function checkRateLimit(key: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (rateLimitBuckets.get(key) ?? []).filter((t) => t > cutoff);
  if (arr.length >= RATE_LIMIT_MAX) {
    const retry = Math.max(1, Math.ceil((arr[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
    rateLimitBuckets.set(key, arr);
    return { ok: false, retryAfterSec: retry };
  }
  arr.push(now);
  rateLimitBuckets.set(key, arr);
  // Opportunistic cleanup to keep the map small.
  if (rateLimitBuckets.size > 5000) {
    for (const [k, v] of rateLimitBuckets) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length === 0) rateLimitBuckets.delete(k);
      else rateLimitBuckets.set(k, kept);
    }
  }
  return { ok: true, retryAfterSec: 0 };
}

export const Route = createFileRoute("/api/public/ask-question")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.MAKE_API_SECRET;
        if (!expected) return json(500, { error: "Server misconfigured" });
        const provided =
          request.headers.get("x-api-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (provided !== expected) return json(401, { error: "Unauthorized" });

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (e) {
          return json(400, {
            error: "Invalid request body",
            details: e instanceof Error ? e.message : String(e),
          });
        }

        const rl = checkRateLimit(body.phone_number);
        if (!rl.ok) {
          return new Response(
            JSON.stringify({
              error: "Rate limited",
              message: "Too many questions. Please wait a moment before asking again.",
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "retry-after": String(rl.retryAfterSec),
              },
            },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Resolve student from phone (server-side; Make.com cannot override bootcamp)
        const { data: student, error: studentErr } = await supabaseAdmin
          .from("students")
          .select("id, bootcamp_id, first_name, last_name, enrollment_status, consent_status")
          .eq("phone_number", body.phone_number)
          .eq("enrollment_status", "active")
          .maybeSingle();
        if (studentErr) return json(500, { error: "Database error" });
        if (!student) {
          return json(404, {
            error: "Student not found",
            message:
              "This phone number is not enrolled in any bootcamp. Please contact your instructor.",
          });
        }
        if (student.consent_status === "revoked") {
          return json(200, { answer: "" });
        }
        if (student.enrollment_status === "suspended") {
          return json(403, {
            error: "Student suspended",
            message:
              "Your access has been temporarily paused. Please contact your instructor.",
          });
        }
        if (student.enrollment_status === "removed") {
          return json(403, {
            error: "Student not active",
            message: "Your enrollment is not active. Please contact your instructor.",
          });
        }

        const trimmed = body.question.trim();
        const upper = trimmed.toUpperCase();

        if (upper === "QUIZ") {
          const { data: lesson } = await supabaseAdmin
            .from("lessons")
            .select("id, title, summary, learning_objectives")
            .eq("bootcamp_id", student.bootcamp_id)
            .eq("status", "published")
            .order("published_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!lesson) {
            return json(200, {
              answer:
                "📚 No quiz yet! Quizzes unlock once your first lesson is published. Stay tuned — we'll let you know when it's ready!",
            });
          }

          const questions = await generateQuizQuestions(lesson);
          if (!questions) {
            return json(200, {
              answer: "Sorry, we couldn't generate a quiz right now. Please try again later.",
            });
          }

          const { data: existing } = await supabaseAdmin
            .from("quiz_sessions")
            .select("id, questions, current_question")
            .eq("student_id", student.id)
            .eq("lesson_id", lesson.id)
            .eq("status", "active")
            .maybeSingle();

          if (existing) {
            const q = (existing.questions as QuizQuestion[])[existing.current_question];
            return json(200, {
              answer: formatQuestion(q, existing.current_question + 1),
            });
          }

          const { error: insertErr } = await supabaseAdmin.from("quiz_sessions").insert({
            student_id: student.id,
            lesson_id: lesson.id,
            bootcamp_id: student.bootcamp_id,
            questions,
            answers: [],
            current_question: 0,
            status: "active",
          });

          if (insertErr) {
            console.error("[ask-question] quiz session insert failed:", insertErr);
            return json(200, {
              answer: "Sorry, we couldn't start a quiz right now. Please try again later.",
            });
          }

          return json(200, { answer: formatQuestion(questions[0], 1) });
        }

        if (/^[ABC]$/.test(upper)) {
          const { data: session } = await supabaseAdmin
            .from("quiz_sessions")
            .select("id, questions, answers, current_question")
            .eq("student_id", student.id)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (session) {
            const sessionQuestions = session.questions as QuizQuestion[];
            const currentQ = sessionQuestions[session.current_question];
            const correct = upper === currentQ.correct;
            const sessionAnswers = (session.answers ?? []) as {
              question_index: number;
              answer: string;
              correct: boolean;
            }[];
            const updatedAnswers = [
              ...sessionAnswers,
              {
                question_index: session.current_question,
                answer: upper,
                correct,
              },
            ];

            const nextIndex = session.current_question + 1;
            if (nextIndex < sessionQuestions.length) {
              await supabaseAdmin
                .from("quiz_sessions")
                .update({ current_question: nextIndex, answers: updatedAnswers })
                .eq("id", session.id);

              const feedback = correct ? "✅ Correct!\n\n" : "❌ Not quite.\n\n";
              return json(200, {
                answer:
                  feedback + formatQuestion(sessionQuestions[nextIndex], nextIndex + 1),
              });
            }

            const score = updatedAnswers.filter((a) => a.correct).length;
            await supabaseAdmin
              .from("quiz_sessions")
              .update({
                status: "completed",
                score,
                answers: updatedAnswers,
              })
              .eq("id", session.id);

            return json(200, { answer: formatQuizResults(score, updatedAnswers) });
          }
        }

        if (upper === "STOP") {
          await supabaseAdmin
            .from("students")
            .update({ consent_status: "revoked" })
            .eq("id", student.id);

          return json(200, {
            answer:
              "You have been unsubscribed. You will no longer receive messages from this number. Contact your instructor directly if you need help.",
          });
        }

        if (isHumanEscalation(trimmed)) {
          const { data: recentQuestions } = await supabaseAdmin
            .from("questions")
            .select("question_text, ai_answer")
            .eq("student_id", student.id)
            .order("created_at", { ascending: false })
            .limit(10);

          const formattedHistory = (recentQuestions ?? [])
            .map(
              (q, i) =>
                `${i + 1}. Q: ${q.question_text}\n   A: ${q.ai_answer ?? "(no answer)"}`,
            )
            .join("\n\n");

          const { openaiChat } = await import("@/lib/openai.server");
          const aiSummary = await openaiChat({
            system:
              "You summarise student support requests concisely for an instructor. If there is little history, focus on the triggering message and what the student likely needs.",
            user: `Summarise this student's recent questions and what they were struggling with, in 3-5 sentences. Student name: ${student.first_name}. Recent questions:\n\n${formattedHistory || "(no recent questions)"}\n\nThe message that triggered this escalation was: "${trimmed}"`,
            max_tokens: 300,
          });

          const { error: escalationErr } = await supabaseAdmin.from("escalations").insert({
            student_id: student.id,
            bootcamp_id: student.bootcamp_id,
            summary: aiSummary,
            trigger_message: trimmed,
            status: "open",
          });
          if (escalationErr) {
            console.error("[ask-question] escalation insert failed:", escalationErr);
          }

          const { data: bootcamp } = await supabaseAdmin
            .from("bootcamps")
            .select("name")
            .eq("id", student.bootcamp_id)
            .maybeSingle();

          const webhookUrl = process.env.ESCALATION_EMAIL_WEBHOOK_URL?.trim();
          if (webhookUrl) {
            try {
              const res = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  student_name: student.first_name,
                  bootcamp_name: bootcamp?.name ?? "",
                  summary: aiSummary,
                  created_at: new Date().toISOString(),
                }),
              });
              if (!res.ok) {
                console.error(
                  "[ask-question] escalation email webhook non-2xx",
                  res.status,
                  await res.text().catch(() => ""),
                );
              }
            } catch (e) {
              console.error("[ask-question] escalation email webhook error", e);
            }
          }

          return json(200, {
            answer:
              "I've flagged this for your instructor. Someone will follow up with you shortly. 🙏",
          });
        }

        const { data: kbArticles } = await supabaseAdmin
          .from("kb_articles")
          .select("title, tag, extracted_text")
          .eq("bootcamp_id", student.bootcamp_id)
          .is("deleted_at", null)
          .not("extracted_text", "is", null);

        if (kbArticles && kbArticles.length > 0) {
          const kbContext = formatKbContext(kbArticles);

          const { openaiChat } = await import("@/lib/openai.server");
          const kbResponse = await openaiChat({
            system:
              "You are a helpful assistant for a bootcamp. Answer the student's question using ONLY the knowledge base articles provided. If the knowledge base does not contain a relevant answer, reply with exactly the single word FALLBACK and nothing else.",
            user: `${kbContext}\n\nStudent question: ${body.question}`,
            max_tokens: 500,
          });

          if (kbResponse.trim() !== "FALLBACK") {
            return json(200, { answer: kbResponse });
          }
        }

        try {
          const { askQuestion } = await import("@/lib/ask-question.server");
          const result = await askQuestion({
            studentId: student.id,
            bootcampId: student.bootcamp_id,
            question: body.question,
            externalMessageId: body.external_message_id ?? null,
            log: true,
            includeDebug: false,
          });
          return json(200, {
            question_id: result.question_id,
            answer: result.answer,
            confidence: result.confidence,
            retrieval_method: result.retrieval_method,
            source_lessons: result.source_lessons,
            student: result.student,
          });
        } catch (e) {
          console.error("ask-question error", e);
          return json(500, { error: "Internal error", message: (e as Error).message });
        }
      },

      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type, x-api-secret, authorization",
          },
        }),
    },
  },
});
