import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProcessInput = z.object({
  lesson_id: z.string().uuid(),
  generate_metadata: z.boolean().default(false),
});

/**
 * Re-chunks the lesson transcript, embeds with OpenAI, replaces lesson_chunks,
 * and optionally generates summary/objectives/topics with GPT.
 */
export const processLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProcessInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load lesson (RLS scopes to bootcamps the user can read)
    const { data: lesson, error: lessonErr } = await supabase
      .from("lessons")
      .select("id, bootcamp_id, title, transcript, status")
      .eq("id", data.lesson_id)
      .maybeSingle();
    if (lessonErr) throw new Error(lessonErr.message);
    if (!lesson) throw new Error("Lesson not found or access denied");

    // Must be admin of this bootcamp
    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: lesson.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden: not a bootcamp admin");

    const transcript = (lesson.transcript ?? "").trim();
    if (!transcript) throw new Error("Lesson has no transcript to process");

    const { chunkText, openaiEmbed, openaiChat } = await import("@/lib/openai.server");
    const chunks = chunkText(transcript);
    if (chunks.length === 0) throw new Error("No chunks produced from transcript");

    // Mark processing
    await supabase
      .from("lessons")
      .update({ status: "processing" })
      .eq("id", lesson.id);

    // Embed in batches of 64
    const embeddings: number[][] = [];
    const BATCH = 64;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const vecs = await openaiEmbed(batch);
      embeddings.push(...vecs);
    }

    // Replace chunks (use service role via admin client for clean delete+insert)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("lesson_chunks").delete().eq("lesson_id", lesson.id);

    const rows = chunks.map((text, idx) => ({
      lesson_id: lesson.id,
      bootcamp_id: lesson.bootcamp_id,
      chunk_index: idx,
      chunk_text: text,
      embedding: `[${embeddings[idx].join(",")}]`,
    }));

    // Insert in batches of 100
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
        const sample = transcript.slice(0, 12000);
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
  "key_topics": ["topic 1", "topic 2", "..."]  // 3-8 short topic strings
}`,
          response_format: { type: "json_object" },
          max_tokens: 700,
        });
        const parsed = JSON.parse(raw) as typeof metadata;
        metadata = {
          summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
          learning_objectives:
            typeof parsed.learning_objectives === "string"
              ? parsed.learning_objectives
              : undefined,
          key_topics: Array.isArray(parsed.key_topics)
            ? parsed.key_topics.filter((t) => typeof t === "string").slice(0, 12)
            : undefined,
        };
      } catch (e) {
        console.warn("metadata generation failed", e);
      }
    }

    const update: Record<string, unknown> = { status: "ready" };
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
      // Must have chunks first
      const { count } = await supabase
        .from("lesson_chunks")
        .select("id", { count: "exact", head: true })
        .eq("lesson_id", lesson.id);
      if (!count || count === 0) {
        throw new Error(
          "Lesson has no embedded chunks. Process the transcript before publishing.",
        );
      }
    }

    const { error: upErr } = await supabase
      .from("lessons")
      .update({
        status: data.publish ? "published" : "ready",
        published_at: data.publish ? new Date().toISOString() : null,
      })
      .eq("id", lesson.id);
    if (upErr) throw new Error(upErr.message);

    return { ok: true };
  });
