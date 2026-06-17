import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProcessInput = z.object({
  lesson_id: z.string().uuid(),
  generate_metadata: z.boolean().default(false),
});

/**
 * Re-chunks the lesson transcript and replaces lesson_chunks for full-text
 * search. No more pgvector embeddings; OpenAI File Search is the semantic
 * layer (handled separately by syncLessonToOpenAI).
 */
export const processLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProcessInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: lesson, error: lessonErr } = await supabase
      .from("lessons")
      .select("id, bootcamp_id, title, transcript, status, key_topics, module_name")
      .eq("id", data.lesson_id)
      .maybeSingle();
    if (lessonErr) throw new Error(lessonErr.message);
    if (!lesson) throw new Error("Lesson not found or access denied");

    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden: not a bootcamp admin");

    const transcript = (lesson.transcript ?? "").trim();
    if (!transcript) throw new Error("Lesson has no transcript to process");

    const { chunkText, cleanTranscript, openaiChat } = await import("@/lib/openai.server");
    const cleaned = cleanTranscript(transcript);
    const chunks = chunkText(cleaned);
    if (chunks.length === 0) throw new Error("No chunks produced from transcript");

    await supabase.from("lessons").update({ status: "processing" }).eq("id", lesson.id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("lesson_chunks").delete().eq("lesson_id", lesson.id);

    const topicsStr = (lesson.key_topics ?? []).join(" ");
    const rows = chunks.map((text, idx) => ({
      lesson_id: lesson.id,
      bootcamp_id: lesson.bootcamp_id,
      chunk_index: idx,
      chunk_text: text,
      search_content: [lesson.title, lesson.module_name ?? "", topicsStr, text]
        .filter(Boolean)
        .join(" | "),
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabaseAdmin
        .from("lesson_chunks")
        .insert(rows.slice(i, i + 100));
      if (error) throw new Error(`Insert chunks failed: ${error.message}`);
    }

    let metadata: {
      summary?: string;
      learning_objectives?: string;
      key_topics?: string[];
    } = {};

    if (data.generate_metadata) {
      try {
        const sample = cleaned.slice(0, 12000);
        const raw = await openaiChat({
          system:
            "You analyze bootcamp lesson transcripts. Respond with strict JSON only.",
          user: `Lesson title: "${lesson.title}"
Transcript excerpt:
"""
${sample}
"""

Produce JSON with this exact shape:
{
  "summary": "2-4 sentence summary",
  "learning_objectives": "3-5 bullet lines separated by \\n, each starting with '- '",
  "key_topics": ["topic 1", "topic 2", "..."]
}`,
          response_format: { type: "json_object" },
          max_tokens: 700,
        });
        const parsed = JSON.parse(raw) as typeof metadata;
        metadata = {
          summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
          learning_objectives:
            typeof parsed.learning_objectives === "string" ? parsed.learning_objectives : undefined,
          key_topics: Array.isArray(parsed.key_topics)
            ? parsed.key_topics.filter((t) => typeof t === "string").slice(0, 12)
            : undefined,
        };
      } catch (e) {
        console.warn("metadata generation failed", e);
      }
    }

    const update: Partial<{
      status: "ready";
      summary: string;
      learning_objectives: string;
      key_topics: string[];
    }> = { status: "ready" };
    if (metadata.summary) update.summary = metadata.summary;
    if (metadata.learning_objectives) update.learning_objectives = metadata.learning_objectives;
    if (metadata.key_topics) update.key_topics = metadata.key_topics;

    const { error: updateErr } = await supabase
      .from("lessons")
      .update(update)
      .eq("id", lesson.id);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true, chunk_count: chunks.length, metadata };
  });

const PublishInput = z.object({
  lesson_id: z.string().uuid(),
  publish: z.boolean(),
});

/**
 * Publish/unpublish a lesson.
 * - publish=true: mark published, then run a synchronous-ish sync to the
 *   bootcamp's OpenAI vector store. The sync helper marks the indexing
 *   status itself (uploading -> indexing/ready/error) so the UI can poll.
 * - publish=false: detach the file from the vector store first (so File
 *   Search stops returning it), then mark the lesson unpublished.
 */
export const setLessonPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PublishInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: lesson, error } = await supabase
      .from("lessons")
      .select("id, bootcamp_id, status")
      .eq("id", data.lesson_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lesson) throw new Error("Lesson not found");

    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden");

    if (data.publish) {
      const { count } = await supabase
        .from("lesson_chunks")
        .select("id", { count: "exact", head: true })
        .eq("lesson_id", lesson.id);
      if (!count || count === 0) {
        throw new Error(
          "Lesson has no full-text chunks. Process the transcript before publishing.",
        );
      }

      const { error: upErr } = await supabase
        .from("lessons")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          openai_indexing_status: "uploading",
          openai_sync_error: null,
        })
        .eq("id", lesson.id);
      if (upErr) throw new Error(upErr.message);

      // Upload+attach but do NOT poll-to-ready here. Indexing finishes in the
      // background; the UI polls refreshLessonSyncStatus for completion. This
      // keeps the publish click responsive (typically a few seconds).
      const { syncLessonToVectorStore } = await import("@/lib/lesson-sync.server");
      const syncResult = await syncLessonToVectorStore(lesson.id, false, { waitForReady: false });
      return { ok: true, sync: syncResult };
    }

    // Unpublish
    const { unsyncLessonFromVectorStore } = await import("@/lib/lesson-sync.server");
    await unsyncLessonFromVectorStore(lesson.id);
    const { error: upErr } = await supabase
      .from("lessons")
      .update({ status: "ready", published_at: null })
      .eq("id", lesson.id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

const ResyncInput = z.object({ lesson_id: z.string().uuid(), force: z.boolean().default(true) });

/** Force re-upload + re-attach to OpenAI vector store. Admin only. */
export const resyncLessonToOpenAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ResyncInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lesson } = await supabase
      .from("lessons")
      .select("id, bootcamp_id")
      .eq("id", data.lesson_id)
      .maybeSingle();
    if (!lesson) throw new Error("Lesson not found");
    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { syncLessonToVectorStore } = await import("@/lib/lesson-sync.server");
    return syncLessonToVectorStore(lesson.id, data.force);
  });

const RefreshInput = z.object({ lesson_id: z.string().uuid() });

/** Polls OpenAI for current vector-store-file status and updates DB. */
export const refreshLessonSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RefreshInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lesson } = await supabase
      .from("lessons")
      .select("id, bootcamp_id, openai_file_id, openai_indexing_status")
      .eq("id", data.lesson_id)
      .maybeSingle();
    if (!lesson) throw new Error("Lesson not found");
    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden");
    if (!lesson.openai_file_id) return { status: lesson.openai_indexing_status };

    const { data: settings } = await supabase
      .from("bootcamp_settings")
      .select("openai_vector_store_id")
      .eq("bootcamp_id", lesson.bootcamp_id)
      .maybeSingle();
    if (!settings?.openai_vector_store_id) return { status: lesson.openai_indexing_status };

    const { openaiGetVSFile } = await import("@/lib/openai.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const f = await openaiGetVSFile(settings.openai_vector_store_id, lesson.openai_file_id);
      const mapped = f.status === "completed" ? "ready" : f.status === "failed" || f.status === "cancelled" ? "error" : "indexing";
      await supabaseAdmin
        .from("lessons")
        .update({
          openai_indexing_status: mapped,
          openai_indexed_at: mapped === "ready" ? new Date().toISOString() : null,
          openai_sync_error: mapped === "error" ? f.last_error?.message ?? "failed" : null,
        })
        .eq("id", lesson.id);
      return { status: mapped, openai: f.status };
    } catch (e) {
      return { status: "error", error: (e as Error).message };
    }
  });
