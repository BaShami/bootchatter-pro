-- Full-text search on knowledge-base articles (bootcamp-scoped, active only).

ALTER TABLE public.kb_articles
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(extracted_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS kb_articles_search_vector_idx
  ON public.kb_articles USING GIN (search_vector);

CREATE OR REPLACE FUNCTION public.search_kb_articles(
  p_bootcamp_id uuid,
  p_query text,
  p_limit integer DEFAULT 3
)
RETURNS TABLE(
  article_id uuid,
  title text,
  extracted_text text,
  rank real
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tsq tsquery;
  v_or_str text;
BEGIN
  SELECT string_agg(w, ' | ')
    INTO v_or_str
  FROM (
    SELECT DISTINCT w
    FROM regexp_split_to_table(
      lower(regexp_replace(coalesce(p_query, ''), '[^[:alnum:][:space:]]+', ' ', 'g')),
      '\s+'
    ) AS w
    WHERE length(w) >= 2
  ) t;

  IF v_or_str IS NULL OR length(v_or_str) = 0 THEN
    RETURN;
  END IF;

  BEGIN
    v_tsq := to_tsquery('english', v_or_str);
  EXCEPTION WHEN OTHERS THEN
    v_tsq := websearch_to_tsquery('english', coalesce(p_query, ''));
  END;

  IF v_tsq IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id AS article_id,
    a.title,
    a.extracted_text,
    ts_rank_cd(a.search_vector, v_tsq) AS rank
  FROM public.kb_articles a
  WHERE a.bootcamp_id = p_bootcamp_id
    AND a.deleted_at IS NULL
    AND a.extracted_text IS NOT NULL
    AND length(trim(a.extracted_text)) > 0
    AND a.search_vector @@ v_tsq
  ORDER BY rank DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 3), 10));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.search_kb_articles(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_kb_articles(uuid, text, integer) TO service_role;
