/**
 * Cron-driven reconciliation of OpenAI vector-store file indexing.
 *
 * Auth: requires header `x-cron-secret` matching the Vault secret `cron_secret`.
 * Called every 5 minutes by pg_cron. Idempotent.
 *
 * Selects up to 25 lessons stuck in uploading/indexing for > 30s and asks
 * OpenAI for their current status, applying the result to the DB. Concurrency
 * is capped at 3 to avoid route timeouts.
 */
import { createFileRoute } from "@tanstack/react-router";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BATCH_LIMIT = 25;
const CONCURRENCY = 3;
const STUCK_AFTER_SECONDS = 30;

export const Route = createFileRoute("/api/public/hooks/reconcile-indexing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret");
        if (!provided) return json(401, { error: "missing x-cron-secret" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: secretRow, error: secretErr } = await supabaseAdmin.rpc(
          "get_cron_secret",
        );
        if (secretErr || !secretRow) {
          console.error("get_cron_secret failed", secretErr);
          return json(500, { error: "secret unavailable" });
        }
        if (provided !== secretRow) return json(401, { error: "invalid secret" });

        const cutoff = new Date(Date.now() - STUCK_AFTER_SECONDS * 1000).toISOString();

        const { data: rows, error } = await supabaseAdmin
          .from("lessons")
          .select("id, indexing_started_at")
          .in("openai_indexing_status", ["uploading", "indexing"])
          .not("openai_file_id", "is", null)
          .or(
            `indexing_started_at.lt.${cutoff},indexing_started_at.is.null`,
          )
          .order("indexing_started_at", { ascending: true, nullsFirst: true })
          .limit(BATCH_LIMIT);
        if (error) {
          console.error("reconcile select failed", error);
          return json(500, { error: error.message });
        }

        const work = rows ?? [];
        const { reconcileLessonIndexingStatus } = await import(
          "@/lib/lesson-sync.server"
        );

        type Outcome = Awaited<ReturnType<typeof reconcileLessonIndexingStatus>>;
        const results: { lesson_id: string; outcome: Outcome }[] = [];

        let i = 0;
        async function worker() {
          while (i < work.length) {
            const idx = i++;
            const lesson = work[idx];
            try {
              const outcome = await reconcileLessonIndexingStatus(lesson.id);
              results.push({ lesson_id: lesson.id, outcome });
            } catch (e) {
              results.push({
                lesson_id: lesson.id,
                outcome: { outcome: "error", message: (e as Error).message },
              });
            }
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, work.length) }, () => worker()),
        );

        const summary = {
          scanned: work.length,
          ready: results.filter((r) => r.outcome.outcome === "ready").length,
          still_indexing: results.filter((r) => r.outcome.outcome === "still_indexing").length,
          errored: results.filter((r) => r.outcome.outcome === "error").length,
          timed_out: results.filter((r) => r.outcome.outcome === "timed_out").length,
          skipped: results.filter((r) => r.outcome.outcome === "skipped").length,
        };
        return json(200, { ok: true, ...summary, results });
      },
    },
  },
});
