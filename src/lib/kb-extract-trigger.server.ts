export function triggerKbExtraction(articleId: string) {
  void import("@/lib/kb-extract.server").then(({ extractKbArticleText }) =>
    extractKbArticleText(articleId),
  );
}
