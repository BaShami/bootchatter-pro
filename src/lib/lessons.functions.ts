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
      .select("id, bootcamp_id, status, transcript")
      .eq("id", data.lesson_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lesson) throw new Error("Lesson not found");

    const { data: canWrite } = await supabase.rpc("is_bootcamp_teacher", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!canWrite) throw new Error("Forbidden");

    if (data.publish) {
      const transcriptLen = (lesson.transcript ?? "").trim().length;
      if (transcriptLen < 100) {
        throw new Error(
          "Transcript is too short. Please paste the full lesson transcript before publishing.",
        );
      }

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

      const { fireLessonPublishedWebhook } = await import("@/lib/lesson-published-webhook.server");
      void fireLessonPublishedWebhook(lesson.id, lesson.bootcamp_id);

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
    return syncLessonToVectorStore(lesson.id, data.force, { waitForReady: false });
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
      .select("id, bootcamp_id, openai_indexing_status")
      .eq("id", data.lesson_id)
      .maybeSingle();
    if (!lesson) throw new Error("Lesson not found");
    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { reconcileLessonIndexingStatus } = await import("@/lib/lesson-sync.server");
    const outcome = await reconcileLessonIndexingStatus(lesson.id);
    return { outcome };
  });

const FileIdInput = z.object({ file_id: z.string().uuid() });


export const softDeleteLessonFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FileIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: file } = await supabase
      .from("lesson_files")
      .select("id, bootcamp_id")
      .eq("id", data.file_id)
      .maybeSingle();
    if (!file) throw new Error("File not found");
    const { data: ok } = await supabase.rpc("is_bootcamp_teacher", {
      _user_id: userId,
      _bootcamp_id: file.bootcamp_id,
    });
    if (!ok) throw new Error("Forbidden");

    const { error } = await supabase
      .from("lesson_files")
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq("id", data.file_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restoreLessonFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FileIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: file } = await supabase
      .from("lesson_files")
      .select("id, bootcamp_id")
      .eq("id", data.file_id)
      .maybeSingle();
    if (!file) throw new Error("File not found");
    const { data: ok } = await supabase.rpc("is_bootcamp_teacher", {
      _user_id: userId,
      _bootcamp_id: file.bootcamp_id,
    });
    if (!ok) throw new Error("Forbidden");

    const { error } = await supabase
      .from("lesson_files")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", data.file_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Lesson soft-delete / recycle bin ----------------

const LessonIdInput = z.object({ lesson_id: z.string().uuid() });

/** Teacher soft-delete: unpublish (if live) then mark deleted_at. */
export const softDeleteLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LessonIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lesson } = await supabase
      .from("lessons")
      .select("id, bootcamp_id, status")
      .eq("id", data.lesson_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!lesson) throw new Error("Lesson not found");
    const { data: ok } = await supabase.rpc("is_bootcamp_teacher", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!ok) throw new Error("Forbidden");

    if (lesson.status === "published") {
      const { unsyncLessonFromVectorStore } = await import("@/lib/lesson-sync.server");
      try {
        await unsyncLessonFromVectorStore(lesson.id);
      } catch (e) {
        console.warn("unsync on delete failed", e);
      }
      await supabase
        .from("lessons")
        .update({ status: "ready", published_at: null })
        .eq("id", lesson.id);
    }

    const { error } = await supabase
      .from("lessons")
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq("id", lesson.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function requirePlatformAdmin(
  supabase: ReturnType<typeof Object> extends never ? never : any,
  userId: string,
) {
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "platform_admin",
  });
  if (!isAdmin) throw new Error("Forbidden: platform admin only");
}

/** Platform admin: restore a soft-deleted lesson (stays unpublished). */
export const restoreLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LessonIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("lessons")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", data.lesson_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Platform admin: hard-delete lesson row + storage files. */
export const permanentlyDeleteLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LessonIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: files } = await supabaseAdmin
      .from("lesson_files")
      .select("storage_path")
      .eq("lesson_id", data.lesson_id);
    const paths = (files ?? []).map((f) => f.storage_path).filter(Boolean);
    if (paths.length > 0) {
      const { error: rmErr } = await supabaseAdmin.storage.from("lesson-files").remove(paths);
      if (rmErr) console.warn("storage remove failed", rmErr);
    }

    try {
      const { unsyncLessonFromVectorStore } = await import("@/lib/lesson-sync.server");
      await unsyncLessonFromVectorStore(data.lesson_id);
    } catch (e) {
      console.warn("unsync on hard delete failed", e);
    }

    await supabaseAdmin.from("lesson_chunks").delete().eq("lesson_id", data.lesson_id);
    await supabaseAdmin.from("lesson_files").delete().eq("lesson_id", data.lesson_id);
    const { error } = await supabaseAdmin.from("lessons").delete().eq("id", data.lesson_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Platform admin: list all soft-deleted lessons across bootcamps. */
export const listDeletedLessons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await requirePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("lessons")
      .select("id, title, bootcamp_id, deleted_at, deleted_by, bootcamps(name)")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);

    const deleterIds = Array.from(
      new Set((data ?? []).map((l) => l.deleted_by).filter((v): v is string => !!v)),
    );
    let profileMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null }>();
    if (deleterIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", deleterIds);
      profileMap = new Map(
        (profiles ?? []).map((p) => [
          p.id,
          { first_name: p.first_name, last_name: p.last_name, email: p.email },
        ]),
      );
    }

    return (data ?? []).map((l) => {
      const p = l.deleted_by ? profileMap.get(l.deleted_by) : null;
      const deleterName = p
        ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unknown"
        : "Unknown";
      return {
        id: l.id,
        title: l.title,
        bootcamp_id: l.bootcamp_id,
        bootcamp_name: (l.bootcamps as { name?: string } | null)?.name ?? "—",
        deleted_at: l.deleted_at,
        deleted_by_name: deleterName,
      };
    });
  });


