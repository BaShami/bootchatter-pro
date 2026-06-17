import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
for (const q of ["AI agents", "Tell me about AI agents.", "Give me a high-level overview of the core ideas this session was really about, in your own words.", "What is the chemical formula for sulfuric acid and how is it manufactured industrially?"]) {
  const r = await sb.rpc("search_published_lesson_chunks", { p_bootcamp_id: "e051feaf-9271-4815-965c-a2796c26ad58", p_query: q, p_limit: 5 });
  console.log(q, "->", r.error ? "ERR " + r.error.message : `${r.data?.length ?? 0} rows`);
}
