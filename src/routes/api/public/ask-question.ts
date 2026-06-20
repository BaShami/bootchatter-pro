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

// Simple in-memory sliding-window rate limit (single-instance deployment).
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Resolve student from phone (server-side; Make.com cannot override bootcamp)
        const { data: student, error: studentErr } = await supabaseAdmin
          .from("students")
          .select("id, bootcamp_id, first_name, last_name, enrollment_status")
          .eq("phone_number", body.phone_number)
          .maybeSingle();
        if (studentErr) return json(500, { error: "Database error" });
        if (!student) {
          return json(404, {
            error: "Student not found",
            message:
              "This phone number is not enrolled in any bootcamp. Please contact your instructor.",
          });
        }
        if (
          student.enrollment_status === "removed" ||
          student.enrollment_status === "suspended"
        ) {
          return json(403, {
            error: "Student not active",
            message: "Your enrollment is not active. Please contact your instructor.",
          });
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
