import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const r = await sb.rpc("search_published_lesson_chunks", { p_bootcamp_id: "e051feaf-9271-4815-965c-a2796c26ad58", p_query: "AI agents", p_limit: 5 });
console.log(JSON.stringify(r, null, 2));
