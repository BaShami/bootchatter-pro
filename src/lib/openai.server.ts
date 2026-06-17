/**
 * Server-only OpenAI helpers. Never import from browser code.
 * Covers: chat completions (legacy), embeddings (legacy/unused),
 * vector stores, files, and Responses API with file_search.
 */

import { createHash } from "crypto";

const OPENAI_URL = "https://api.openai.com/v1";

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Missing OPENAI_API_KEY");
  return k;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${key()}`,
    ...extra,
  };
}

async function oaiFetch<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.json);
    delete init.json;
  }
  const res = await fetch(`${OPENAI_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...headers },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${path} ${res.status}: ${errText.slice(0, 800)}`);
  }
  return (await res.json()) as T;
}

// ---------- Legacy chat + embeddings (still used by lesson metadata generation) ----------

export async function openaiEmbed(input: string | string[]): Promise<number[][]> {
  const res = await oaiFetch<{ data: { embedding: number[] }[] }>("/embeddings", {
    method: "POST",
    json: { model: "text-embedding-3-small", input },
  });
  return res.data.map((d) => d.embedding);
}

export async function openaiChat(opts: {
  system: string;
  user: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
}): Promise<string> {
  const res = await oaiFetch<{ choices: { message: { content: string } }[] }>(
    "/chat/completions",
    {
      method: "POST",
      json: {
        model: opts.model ?? "gpt-4o-mini",
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.max_tokens ?? 800,
        response_format: opts.response_format,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      },
    },
  );
  return res.choices[0]?.message?.content ?? "";
}

// ---------- Transcript chunking & cleaning ----------

/** Strip common transcript noise: [hh:mm:ss], speaker tags, repeated whitespace. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, " ")
    .replace(/\(\d{1,2}:\d{2}(?::\d{2})?\)/g, " ")
    .replace(/^\s*[A-Z][A-Za-z .'-]{1,40}:\s/gm, "") // Speaker: lines
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkText(text: string, target = 900, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return [];
  if (clean.length <= target) return [clean];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + target, clean.length);
    if (end < clean.length) {
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

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------- Vector stores ----------

export type VectorStore = { id: string; name: string; status: string };

export async function openaiCreateVectorStore(name: string): Promise<VectorStore> {
  return oaiFetch<VectorStore>("/vector_stores", { method: "POST", json: { name } });
}

export async function openaiGetVectorStore(id: string): Promise<VectorStore> {
  return oaiFetch<VectorStore>(`/vector_stores/${id}`);
}

// ---------- Files ----------

export type OAIFile = { id: string; filename: string; bytes: number; purpose: string };

/** Upload a text file. content is the file body as a string. */
export async function openaiUploadFile(content: string, filename: string): Promise<OAIFile> {
  const form = new FormData();
  form.append("purpose", "assistants");
  form.append(
    "file",
    new Blob([content], { type: "text/markdown" }),
    filename,
  );
  const res = await fetch(`${OPENAI_URL}/files`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI file upload ${res.status}: ${t.slice(0, 800)}`);
  }
  return (await res.json()) as OAIFile;
}

export async function openaiDeleteFile(fileId: string): Promise<void> {
  // Best-effort: ignore 404s
  const res = await fetch(`${OPENAI_URL}/files/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    console.warn(`openaiDeleteFile ${fileId} ${res.status}: ${t.slice(0, 200)}`);
  }
}

// ---------- Vector store files ----------

export type VSFile = {
  id: string;
  vector_store_id: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  last_error?: { message: string } | null;
  attributes?: Record<string, unknown>;
};

export async function openaiAttachFileToVectorStore(
  vsId: string,
  fileId: string,
  attributes: Record<string, string | number | boolean>,
): Promise<VSFile> {
  return oaiFetch<VSFile>(`/vector_stores/${vsId}/files`, {
    method: "POST",
    json: { file_id: fileId, attributes },
  });
}

export async function openaiUpdateVSFileAttributes(
  vsId: string,
  fileId: string,
  attributes: Record<string, string | number | boolean>,
): Promise<VSFile> {
  return oaiFetch<VSFile>(`/vector_stores/${vsId}/files/${fileId}`, {
    method: "POST",
    json: { attributes },
  });
}

export async function openaiGetVSFile(vsId: string, fileId: string): Promise<VSFile> {
  return oaiFetch<VSFile>(`/vector_stores/${vsId}/files/${fileId}`);
}

export async function openaiDetachVSFile(vsId: string, fileId: string): Promise<void> {
  const res = await fetch(`${OPENAI_URL}/vector_stores/${vsId}/files/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    console.warn(`openaiDetachVSFile ${fileId} ${res.status}: ${t.slice(0, 200)}`);
  }
}

// ---------- Responses API with file_search ----------

export type ResponsesRequest = {
  model: string;
  instructions: string;
  input: string;
  vectorStoreId: string;
  maxNumResults?: number;
  schema: Record<string, unknown>;
  schemaName: string;
};

export type FileSearchResult = {
  file_id: string;
  filename?: string;
  score?: number;
  attributes?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
};

export type FileSearchCall = {
  type: "file_search_call";
  id: string;
  status: string;
  queries?: string[];
  results?: FileSearchResult[];
};

export type ResponsesOutput = {
  id: string;
  output: Array<
    | FileSearchCall
    | {
        type: "message";
        content: Array<{ type: string; text?: string }>;
      }
    | { type: string; [k: string]: unknown }
  >;
  output_text?: string;
};

export async function openaiResponsesFileSearch(req: ResponsesRequest): Promise<ResponsesOutput> {
  return oaiFetch<ResponsesOutput>("/responses", {
    method: "POST",
    json: {
      model: req.model,
      instructions: req.instructions,
      input: req.input,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [req.vectorStoreId],
          max_num_results: req.maxNumResults ?? 5,
          filters: { type: "eq", key: "published", value: true },
        },
      ],
      include: ["file_search_call.results"],
      text: {
        format: {
          type: "json_schema",
          name: req.schemaName,
          schema: req.schema,
          strict: true,
        },
      },
    },
  });
}

/** Extract the assistant text (which is JSON when structured output is used). */
export function extractMessageText(resp: ResponsesOutput): string {
  if (resp.output_text) return resp.output_text;
  for (const item of resp.output) {
    if (item.type === "message" && "content" in item) {
      const parts = (item as { content: Array<{ type: string; text?: string }> }).content;
      const t = parts.find((p) => p.text)?.text;
      if (t) return t;
    }
  }
  return "";
}

export function extractFileSearchCall(resp: ResponsesOutput): FileSearchCall | null {
  return (
    (resp.output.find((o) => o.type === "file_search_call") as FileSearchCall | undefined) ?? null
  );
}
