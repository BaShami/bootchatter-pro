import mammoth from "mammoth";

const MAX_EXTRACTED_CHARS = 20_000;

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer);
  const doc = await getDocument({ data: uint8 }).promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it: any) => ("str" in it ? it.str : "")).join(" "));
    }
    return parts.join("\n");
  } finally {
    await doc.destroy();
  }
}

export async function extractKbArticleText(articleId: string) {
  console.log("[extractKbArticleText] start", { articleId });

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

    console.log("[extractKbArticleText] article fetched", {
      articleId: article.id,
      bootcampId: article.bootcamp_id,
      filePath: article.file_path,
      fileType: article.file_type,
    });

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

    console.log("[extractKbArticleText] file downloaded", {
      articleId,
      byteLength: buffer.byteLength,
      fileType,
      ext,
    });

    let extracted = "";

    if (fileType === "text/plain" || fileType === "text/markdown" || ext === "txt" || ext === "md") {
      extracted = buffer.toString("utf-8");
      console.log("[extractKbArticleText] extracted as plain text", {
        articleId,
        charLength: extracted.length,
      });
    } else if (fileType === "application/pdf" || ext === "pdf") {
      extracted = await extractPdfText(buffer);
      console.log("[extractKbArticleText] extracted as pdf", {
        articleId,
        charLength: extracted.length,
      });
    } else if (
      fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      console.log("[extractKbArticleText] extracting docx with mammoth", { articleId });
      const { value } = await mammoth.extractRawText({ buffer });
      extracted = value;
      console.log("[extractKbArticleText] extracted as docx", {
        articleId,
        charLength: extracted.length,
      });
    } else {
      console.error("[extractKbArticleText] unsupported file type:", {
        articleId,
        fileType: article.file_type,
        ext,
      });
      return;
    }

    const truncated =
      extracted.length > MAX_EXTRACTED_CHARS
        ? extracted.slice(0, MAX_EXTRACTED_CHARS)
        : extracted;

    console.log("[extractKbArticleText] updating extracted_text", {
      articleId,
      originalLength: extracted.length,
      storedLength: truncated.length,
    });

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("kb_articles")
      .update({ extracted_text: truncated })
      .eq("id", articleId)
      .select("id, extracted_text")
      .maybeSingle();

    if (updateError) {
      console.error("[extractKbArticleText] update failed:", updateError);
      return;
    }

    console.log("[extractKbArticleText] update complete", {
      articleId,
      hasExtractedText: Boolean(updated?.extracted_text?.length),
      extractedTextLength: updated?.extracted_text?.length ?? 0,
    });
  } catch (e) {
    console.error("[extractKbArticleText] error:", e);
  }
}
