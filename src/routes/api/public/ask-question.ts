import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  phone_number: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "phone_number must be E.164 format, e.g. +14155551234"),
  question: z.string().trim().min(2).max(2000),
  external_message_id: z.string().trim().max(200).optional(),
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/ask-question")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Authenticate caller (Make.com)
        const expected = process.env.MAKE_API_SECRET;
        if (!expected) {
          console.error("ask-question: MAKE_API_SECRET not configured");
          return json(500, { error: "Server misconfigured" });
        }
        const provided =
          request.headers.get("x-api-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (provided !== expected) {
          return json(401, { error: "Unauthorized" });
        }

        // 2. Validate body
        let body: z.infer<typeof BodySchema>;
        try {
          const raw = await request.json();
          body = BodySchema.parse(raw);
        } catch (e) {
          return json(400, {
            error: "Invalid request body",
            details: e instanceof Error ? e.message : String(e),
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { openaiEmbed, openaiChat } = await import("@/lib/openai.server");

        // 3. Look up student by phone
        const { data: student, error: studentErr } = await supabaseAdmin
          .from("students")
          .select("id, bootcamp_id, first_name, last_name, enrollment_status")
          .eq("phone_number", body.phone_number)
          .maybeSingle();
        if (studentErr) {
          console.error("student lookup error", studentErr);
          return json(500, { error: "Database error" });
        }
        if (!student) {
          return json(404, {
            error: "Student not found",
            message:
              "This phone number is not enrolled in any bootcamp. Please contact your instructor.",
          });
        }
        if (student.enrollment_status === "removed" || student.enrollment_status === "suspended") {
          return json(403, {
            error: "Student not active",
            message: "Your enrollment is not active. Please contact your instructor.",
          });
        }

        // 4. Load bootcamp settings (fallback answer, similarity, retrieval limit)
        const { data: settings } = await supabaseAdmin
          .from("bootcamp_settings")
          .select("fallback_answer, minimum_similarity, retrieval_limit, max_answer_length, ai_instructions")
          .eq("bootcamp_id", student.bootcamp_id)
          .maybeSingle();

        const minSim = settings?.minimum_similarity ?? 0.3;
        const retrievalLimit = Math.min(settings?.retrieval_limit ?? 6, 12);
        const maxAnswerLen = settings?.max_answer_length ?? 600;
        const fallback =
          settings?.fallback_answer ??
          "I can't find an answer to that in your lessons yet. Your instructor will follow up.";

        // 5. Embed question
        let questionVec: number[];
        try {
          const [vec] = await openaiEmbed(body.question);
          questionVec = vec;
        } catch (e) {
          console.error("embedding error", e);
          return json(502, { error: "Embedding service unavailable" });
        }

        // 6. Vector search across PUBLISHED lessons for this bootcamp
        const { data: matches, error: matchErr } = await supabaseAdmin.rpc(
          "match_lesson_chunks",
          {
            query_embedding: `[${questionVec.join(",")}]` as unknown as string,
            p_bootcamp_id: student.bootcamp_id,
            match_count: retrievalLimit,
            min_similarity: minSim,
          },
        );
        if (matchErr) {
          console.error("match error", matchErr);
          return json(500, { error: "Search failed" });
        }

        const hits = matches ?? [];
        let answer = fallback;
        let confidence = 0;
        const sourceLessonIds = Array.from(
          new Set(hits.map((h) => h.lesson_id as string)),
        );

        // 7. Generate answer if we have context
        if (hits.length > 0) {
          const topSim = Math.max(...hits.map((h) => Number(h.similarity) || 0));
          confidence = Number(topSim.toFixed(3));

          const context = hits
            .map(
              (h, i) =>
                `[Source ${i + 1} — Lesson: ${h.lesson_title}]\n${h.chunk_text}`,
            )
            .join("\n\n---\n\n");

          try {
            const sys = `You are a bootcamp study assistant. Answer the student's question using ONLY the provided lesson excerpts. ${settings?.ai_instructions ?? ""}

Rules:
- If the excerpts do not contain the answer, say so plainly and suggest they ask their instructor.
- Be concise (under ${maxAnswerLen} characters).
- Do not invent facts not present in the excerpts.
- Write in the same language as the student's question.
- Cite the source lesson titles inline when helpful, e.g. "(Lesson: …)".`;

            const userMsg = `Student question:\n${body.question}\n\nLesson excerpts:\n${context}`;
            const generated = await openaiChat({
              system: sys,
              user: userMsg,
              max_tokens: 500,
              temperature: 0.2,
            });
            answer = generated.trim() || fallback;
            if (answer.length > maxAnswerLen + 200) {
              answer = answer.slice(0, maxAnswerLen + 200);
            }
          } catch (e) {
            console.error("answer generation error", e);
            answer = fallback;
            confidence = 0;
          }
        }

        // 8. Log to questions table + update last_active
        const { data: logged } = await supabaseAdmin
          .from("questions")
          .insert({
            bootcamp_id: student.bootcamp_id,
            student_id: student.id,
            question_text: body.question,
            ai_answer: answer,
            confidence_score: confidence,
            referenced_lessons: sourceLessonIds,
            retrieved_chunks: hits.map((h) => ({
              chunk_id: h.chunk_id,
              lesson_id: h.lesson_id,
              lesson_title: h.lesson_title,
              similarity: Number(h.similarity),
            })),
            external_message_id: body.external_message_id ?? null,
            review_status: confidence < minSim || hits.length === 0 ? "unresolved" : "unreviewed",
          })
          .select("id")
          .single();

        await supabaseAdmin
          .from("students")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", student.id);

        // 9. Return
        return json(200, {
          question_id: logged?.id ?? null,
          answer,
          confidence,
          source_lessons: hits.map((h) => ({
            lesson_id: h.lesson_id,
            title: h.lesson_title,
            similarity: Number(h.similarity),
          })),
          student: { first_name: student.first_name, last_name: student.last_name },
        });
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
