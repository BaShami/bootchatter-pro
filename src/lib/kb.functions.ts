import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX_FILES = 10;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = ["txt", "md", "pdf", "docx"] as const;
const ALLOWED_MIME = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const UploadInput = z.object({
  bootcamp_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  tag: z.enum(["operational", "reference"]),
  file_name: z.string().min(1).max(255),
  file_type: z.string().min(1).max(255),
  file_size: z.number().int().positive().max(MAX_SIZE),
  file_base64: z.string().min(1),
});

export const uploadKbArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UploadInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: data.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden: only bootcamp admins can upload KB articles");

    const ext = data.file_name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
      throw new Error("Unsupported file type. Allowed: .txt, .md, .pdf, .docx");
    }
    // mime is best-effort: trust extension if mime is generic
    if (data.file_type && !ALLOWED_MIME.has(data.file_type) && data.file_type !== "application/octet-stream") {
      // allow if extension is valid; some browsers send odd mimes for .md
    }

    const { count, error: countErr } = await supabase
      .from("kb_articles")
      .select("id", { count: "exact", head: true })
      .eq("bootcamp_id", data.bootcamp_id)
      .is("deleted_at", null);
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) >= MAX_FILES) {
      throw new Error(`Limit reached: max ${MAX_FILES} active KB articles per bootcamp.`);
    }

    const articleId = crypto.randomUUID();
    const safeName = data.file_name.replace(/[^\w.\-]+/g, "_");
    const path = `${data.bootcamp_id}/${articleId}/${safeName}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const binary = Buffer.from(data.file_base64, "base64");
    if (binary.byteLength !== data.file_size) {
      // size mismatch is fine, use actual
    }
    if (binary.byteLength > MAX_SIZE) throw new Error("File exceeds 5MB limit");

    const { error: upErr } = await supabaseAdmin.storage
      .from("kb-files")
      .upload(path, binary, {
        contentType: data.file_type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { error: insErr } = await supabaseAdmin.from("kb_articles").insert({
      id: articleId,
      bootcamp_id: data.bootcamp_id,
      title: data.title,
      tag: data.tag,
      file_path: path,
      file_name: data.file_name,
      file_type: data.file_type || "application/octet-stream",
      file_size: binary.byteLength,
      created_by: userId,
    });
    if (insErr) {
      await supabaseAdmin.storage.from("kb-files").remove([path]);
      throw new Error(insErr.message);
    }

    const { triggerKbExtraction } = await import("@/lib/kb-extract-trigger.server");
    void triggerKbExtraction(articleId);

    return { id: articleId };
  });

const IdInput = z.object({ article_id: z.string().uuid() });

export const deleteKbArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("kb_articles")
      .select("id, bootcamp_id")
      .eq("id", data.article_id)
      .maybeSingle();
    if (!row) throw new Error("Article not found");
    const { data: isAdmin } = await supabase.rpc("is_bootcamp_admin", {
      _user_id: userId,
      _bootcamp_id: row.bootcamp_id,
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { error } = await supabase
      .from("kb_articles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.article_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ListInput = z.object({ bootcamp_id: z.string().uuid() });

export const listKbArticles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("kb_articles")
      .select("id, title, tag, file_name, file_size, file_type, created_at")
      .eq("bootcamp_id", data.bootcamp_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
