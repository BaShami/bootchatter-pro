/**
 * Server-only OpenAI client helpers. Never import from browser code.
 */

const OPENAI_URL = "https://api.openai.com/v1";

export async function openaiEmbed(input: string | string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch(`${OPENAI_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embeddings error ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

export async function openaiChat(opts: {
  system: string;
  user: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const res = await fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: opts.model ?? "gpt-4o-mini",
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.max_tokens ?? 800,
      response_format: opts.response_format,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI chat error ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? "";
}

/**
 * Splits text into ~800-char chunks with ~120-char overlap on sentence/paragraph boundaries.
 */
export function chunkText(text: string, target = 900, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return [];
  if (clean.length <= target) return [clean];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + target, clean.length);
    if (end < clean.length) {
      // try to break on sentence boundary
      const slice = clean.slice(i, end + 100);
      const m = slice.match(/[.!?]\s/g);
      if (m && m.length) {
        const lastIdx = slice.lastIndexOf(m[m.length - 1]);
        if (lastIdx > target * 0.6) end = i + lastIdx + 1;
      }
    }
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks.filter((c) => c.length > 0);
}
