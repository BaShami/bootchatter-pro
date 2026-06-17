/**
 * Client-side document parser. Extracts plain text from
 * TXT, MD, DOCX, and PDF files in the browser before sending
 * the transcript to the server for chunking/embedding.
 */

export type ParsedDoc = { text: string; pages?: number };

export async function parseDocument(file: File): Promise<ParsedDoc> {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md") || type.startsWith("text/")) {
    const text = await file.text();
    return { text: normalize(text) };
  }

  if (name.endsWith(".docx") || type.includes("officedocument.wordprocessingml")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return { text: normalize(value) };
  }

  if (name.endsWith(".pdf") || type === "application/pdf") {
    return parsePdf(file);
  }

  throw new Error(`Unsupported file type: ${file.name}. Use TXT, MD, DOCX, or PDF.`);
}

async function parsePdf(file: File): Promise<ParsedDoc> {
  const pdfjs = await import("pdfjs-dist");
  // Use a workerless build via inline worker URL (legacy build for broad compatibility)
  // @ts-expect-error - pdf.worker.mjs has no types
  const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    parts.push(line);
  }
  return { text: normalize(parts.join("\n\n")), pages: doc.numPages };
}

function normalize(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
