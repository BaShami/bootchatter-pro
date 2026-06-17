
-- bootcamp_settings additions
ALTER TABLE public.bootcamp_settings
  ADD COLUMN IF NOT EXISTS openai_vector_store_id text,
  ADD COLUMN IF NOT EXISTS vector_store_status text NOT NULL DEFAULT 'not_created',
  ADD COLUMN IF NOT EXISTS ai_model text NOT NULL DEFAULT 'gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS full_text_result_limit integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS file_search_result_limit integer NOT NULL DEFAULT 5;

-- lessons additions
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS openai_file_id text,
  ADD COLUMN IF NOT EXISTS openai_indexing_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS openai_indexed_at timestamptz,
  ADD COLUMN IF NOT EXISTS openai_sync_error text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_hash text;

-- lesson_chunks additions: search_content + generated tsvector + GIN index
ALTER TABLE public.lesson_chunks
  ADD COLUMN IF NOT EXISTS search_content text,
  ADD COLUMN IF NOT EXISTS full_text_metadata jsonb;

-- Backfill search_content for existing rows
UPDATE public.lesson_chunks c
SET search_content = concat_ws(' | ',
  l.title,
  array_to_string(coalesce(l.key_topics, ARRAY[]::text[]), ' '),
  c.chunk_text
)
FROM public.lessons l
WHERE c.lesson_id = l.id AND c.search_content IS NULL;

-- Generated tsvector column (English). STORED so it can be GIN-indexed.
ALTER TABLE public.lesson_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_content, ''))) STORED;

CREATE INDEX IF NOT EXISTS lesson_chunks_search_vector_idx
  ON public.lesson_chunks USING GIN (search_vector);

-- questions additions
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS retrieval_method text,
  ADD COLUMN IF NOT EXISTS full_text_results jsonb,
  ADD COLUMN IF NOT EXISTS file_search_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS file_search_results jsonb,
  ADD COLUMN IF NOT EXISTS source_lessons jsonb,
  ADD COLUMN IF NOT EXISTS retrieval_debug jsonb,
  ADD COLUMN IF NOT EXISTS openai_response_id text;

-- Retrieval RPC: bootcamp-scoped, published-only, ranked full-text search
CREATE OR REPLACE FUNCTION public.search_published_lesson_chunks(
  p_bootcamp_id uuid,
  p_query text,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  lesson_id uuid,
  lesson_title text,
  chunk_id uuid,
  chunk_text text,
  rank real
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('english', coalesce(p_query, '')) AS tsq
  )
  SELECT
    c.lesson_id,
    l.title AS lesson_title,
    c.id AS chunk_id,
    c.chunk_text,
    ts_rank_cd(c.search_vector, q.tsq) AS rank
  FROM public.lesson_chunks c
  JOIN public.lessons l ON l.id = c.lesson_id
  CROSS JOIN q
  WHERE c.bootcamp_id = p_bootcamp_id
    AND l.status = 'published'
    AND c.search_vector @@ q.tsq
  ORDER BY rank DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 5), 20));
$$;

-- Lock down: only service_role may EXECUTE
REVOKE ALL ON FUNCTION public.search_published_lesson_chunks(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_published_lesson_chunks(uuid, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.search_published_lesson_chunks(uuid, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_published_lesson_chunks(uuid, text, integer) TO service_role;
