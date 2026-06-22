import mammoth from "mammoth";

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, disableWorker: true } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" "));
  }
  return parts.join("\n\n");
}

const MAX_EXTRACTED_CHARS = 20_000;

export async function extractKbArticleText(articleId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: article, error: articleError } = await supabaseAdmin
      .from("kb_articles")
      .select("id, file_path, file_type, bootcamp_id")
      .eq("id", articleId)
      .maybeSingle();

    if (articleError) {
      console.error("[extractKbArticleText] article fetch failed:", articleError);
      return;
    }
    if (!article) {
      console.error("[extractKbArticleText] article not found:", articleId);
      return;
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("kb-files")
      .download(article.file_path);

    if (downloadError || !fileData) {
      console.error("[extractKbArticleText] download failed:", downloadError);
      return;
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const fileType = article.file_type.toLowerCase();
    const ext = article.file_path.split(".").pop()?.toLowerCase() ?? "";

    let extracted = "";

    if (fileType === "text/plain" || fileType === "text/markdown" || ext === "txt" || ext === "md") {
      extracted = buffer.toString("utf-8");
    } else if (fileType === "application/pdf" || ext === "pdf") {
      const parsed = await pdfParse(buffer);
      extracted = parsed.text;
    } else if (
      fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      const { value } = await mammoth.extractRawText({ buffer });
      extracted = value;
    } else {
      console.error("[extractKbArticleText] unsupported file type:", article.file_type);
      return;
    }

    const truncated =
      extracted.length > MAX_EXTRACTED_CHARS
        ? extracted.slice(0, MAX_EXTRACTED_CHARS)
        : extracted;

    const { error: updateError } = await supabaseAdmin
      .from("kb_articles")
      .update({ extracted_text: truncated })
      .eq("id", articleId);

    if (updateError) {
      console.error("[extractKbArticleText] update failed:", updateError);
    }
  } catch (e) {
    console.error("[extractKbArticleText] error:", e);
  }
}
