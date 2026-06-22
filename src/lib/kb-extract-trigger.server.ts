export async function triggerKbExtraction(articleId: string) {
  console.log("[triggerKbExtraction] scheduling extraction", { articleId });

  try {
    const { extractKbArticleText } = await import("@/lib/kb-extract.server");
    await extractKbArticleText(articleId);
    console.log("[triggerKbExtraction] extraction finished", { articleId });
  } catch (e) {
    console.error("[triggerKbExtraction] extraction failed:", e);
  }
}
