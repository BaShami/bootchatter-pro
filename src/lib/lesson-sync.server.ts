/**
 * Server-only lesson <-> OpenAI vector-store sync.
 * Safe import order: upload new file -> attach + wait ready -> update DB
 * reference -> detach old file -> delete old file.
 *
 * On unpublish: flip published=false attribute first (so File Search filter
 * excludes it immediately), then detach + delete.
 */

import {
  cleanTranscript,
  openaiAttachFileToVectorStore,
  openaiCreateVectorStore,
  openaiDeleteFile,
  openaiDetachVSFile,
  openaiGetVSFile,
  openaiUpdateVSFileAttributes,
  openaiUploadFile,
  sha256,
} from "@/lib/openai.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VS_POLL_INTERVAL_MS = 1500;

async function pollVSFileReady(vsId: string, vsFileId: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const f = await openaiGetVSFile(vsId, vsFileId);
    if (f.status === "completed") return;
    if (f.status === "failed" || f.status === "cancelled") {
      throw new Error(`Vector-store file ${f.status}: ${f.last_error?.message ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, VS_POLL_INTERVAL_MS));
  }
  throw new Error(`Vector-store indexing did not complete within ${Math.round(timeoutMs / 1000)}s`);
}

export async function ensureBootcampVectorStore(bootcampId: string): Promise<string> {
  const { data: settings } = await supabaseAdmin
    .from("bootcamp_settings")
    .select("openai_vector_store_id, vector_store_status")
    .eq("bootcamp_id", bootcampId)
    .maybeSingle();

  if (settings?.openai_vector_store_id) return settings.openai_vector_store_id;

  const { data: bc } = await supabaseAdmin
    .from("bootcamps")
    .select("name")
    .eq("id", bootcampId)
    .maybeSingle();

  const vs = await openaiCreateVectorStore(`bootcamp-${bootcampId} ${bc?.name ?? ""}`.trim());

  await supabaseAdmin
    .from("bootcamp_settings")
    .update({ openai_vector_store_id: vs.id, vector_store_status: "ready" })
    .eq("bootcamp_id", bootcampId);

  return vs.id;
}

function buildLessonDocument(lesson: {
  id: string;
  bootcamp_id: string;
  title: string;
  module_name: string | null;
  lesson_date: string | null;
  summary: string | null;
  learning_objectives: string | null;
  key_topics: string[] | null;
  transcript: string;
}): { content: string; hash: string } {
  const cleaned = cleanTranscript(lesson.transcript);
  const md = [
    `# ${lesson.title}`,
    ``,
    `- bootcamp_id: ${lesson.bootcamp_id}`,
    `- lesson_id: ${lesson.id}`,
    lesson.module_name ? `- module: ${lesson.module_name}` : "",
    lesson.lesson_date ? `- date: ${lesson.lesson_date}` : "",
    ``,
    lesson.summary ? `## Summary\n${lesson.summary}\n` : "",
    lesson.learning_objectives ? `## Learning objectives\n${lesson.learning_objectives}\n` : "",
    lesson.key_topics?.length ? `## Key topics\n${lesson.key_topics.join(", ")}\n` : "",
    `## Transcript`,
    cleaned,
  ]
    .filter(Boolean)
    .join("\n");
  return { content: md, hash: sha256(md) };
}

export type SyncResult = {
  ok: boolean;
  status: "ready" | "indexing" | "error";
  file_id?: string;
  error?: string;
  unchanged?: boolean;
};

/** Idempotent full sync. If content_hash unchanged and a file already exists,
 *  re-asserts attributes (e.g. published=true) and returns unchanged=true. */
export async function syncLessonToVectorStore(lessonId: string, force = false): Promise<SyncResult> {
  const { data: lesson, error } = await supabaseAdmin
    .from("lessons")
    .select(
      "id, bootcamp_id, title, module_name, lesson_date, summary, learning_objectives, key_topics, transcript, openai_file_id, content_hash, status",
    )
    .eq("id", lessonId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lesson) throw new Error("Lesson not found");
  if (!lesson.transcript?.trim()) throw new Error("Lesson has no transcript");

  await supabaseAdmin
    .from("lessons")
    .update({ openai_indexing_status: "uploading", openai_sync_error: null })
    .eq("id", lessonId);

  try {
    const vsId = await ensureBootcampVectorStore(lesson.bootcamp_id);
    const doc = buildLessonDocument({
      id: lesson.id,
      bootcamp_id: lesson.bootcamp_id,
      title: lesson.title,
      module_name: lesson.module_name,
      lesson_date: lesson.lesson_date,
      summary: lesson.summary,
      learning_objectives: lesson.learning_objectives,
      key_topics: lesson.key_topics,
      transcript: lesson.transcript,
    });

    const attributes = {
      lesson_id: lesson.id,
      bootcamp_id: lesson.bootcamp_id,
      published: true,
      content_hash: doc.hash,
    };

    // Unchanged path: re-assert attributes (especially published=true on republish).
    if (!force && lesson.openai_file_id && lesson.content_hash === doc.hash) {
      try {
        await openaiUpdateVSFileAttributes(vsId, lesson.openai_file_id, attributes);
      } catch (e) {
        console.warn("attribute refresh failed", e);
      }
      await supabaseAdmin
        .from("lessons")
        .update({
          openai_indexing_status: "ready",
          openai_indexed_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", lessonId);
      return { ok: true, status: "ready", file_id: lesson.openai_file_id, unchanged: true };
    }

    // Upload new file
    const filename = `lesson-${lesson.id}.md`;
    const uploaded = await openaiUploadFile(doc.content, filename);

    // Attach + wait for indexing (soft timeout: status stays 'indexing' if slow)
    await openaiAttachFileToVectorStore(vsId, uploaded.id, attributes);

    const previousFileId = lesson.openai_file_id;
    let finalStatus: "ready" | "indexing" = "indexing";

    try {
      await pollVSFileReady(vsId, uploaded.id);
      finalStatus = "ready";
    } catch (e) {
      console.warn("indexing not complete in time", (e as Error).message);
    }

    // Update DB to point at new file BEFORE removing the old one.
    await supabaseAdmin
      .from("lessons")
      .update({
        openai_file_id: uploaded.id,
        content_hash: doc.hash,
        openai_indexing_status: finalStatus,
        openai_indexed_at: finalStatus === "ready" ? new Date().toISOString() : null,
        last_synced_at: new Date().toISOString(),
        openai_sync_error: null,
      })
      .eq("id", lessonId);

    // Best-effort cleanup of old file
    if (previousFileId && previousFileId !== uploaded.id) {
      try {
        await openaiDetachVSFile(vsId, previousFileId);
      } catch (e) {
        console.warn("detach old failed", e);
      }
      try {
        await openaiDeleteFile(previousFileId);
      } catch (e) {
        console.warn("delete old failed", e);
      }
    }

    return { ok: true, status: finalStatus, file_id: uploaded.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("lessons")
      .update({ openai_indexing_status: "error", openai_sync_error: msg })
      .eq("id", lessonId);
    return { ok: false, status: "error", error: msg };
  }
}

/** Mark file as unpublished and detach. Idempotent. */
export async function unsyncLessonFromVectorStore(lessonId: string): Promise<void> {
  const { data: lesson } = await supabaseAdmin
    .from("lessons")
    .select("bootcamp_id, openai_file_id")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson?.openai_file_id) return;

  const { data: settings } = await supabaseAdmin
    .from("bootcamp_settings")
    .select("openai_vector_store_id")
    .eq("bootcamp_id", lesson.bootcamp_id)
    .maybeSingle();

  const vsId = settings?.openai_vector_store_id;
  if (!vsId) return;

  // 1. Flip published=false so File Search filter excludes immediately.
  try {
    await openaiUpdateVSFileAttributes(vsId, lesson.openai_file_id, {
      lesson_id: lessonId,
      bootcamp_id: lesson.bootcamp_id,
      published: false,
      content_hash: "",
    });
  } catch (e) {
    console.warn("flip published=false failed", e);
  }

  // 2. Detach + delete (best effort)
  try {
    await openaiDetachVSFile(vsId, lesson.openai_file_id);
  } catch (e) {
    console.warn("detach failed", e);
  }
  try {
    await openaiDeleteFile(lesson.openai_file_id);
  } catch (e) {
    console.warn("delete failed", e);
  }

  await supabaseAdmin
    .from("lessons")
    .update({
      openai_file_id: null,
      openai_indexing_status: "not_synced",
      openai_indexed_at: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", lessonId);
}
