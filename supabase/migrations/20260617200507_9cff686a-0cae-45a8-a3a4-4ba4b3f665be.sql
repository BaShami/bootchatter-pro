CREATE OR REPLACE FUNCTION public.search_published_lesson_chunks(p_bootcamp_id uuid, p_query text, p_limit integer DEFAULT 5)
 RETURNS TABLE(lesson_id uuid, lesson_title text, chunk_id uuid, chunk_text text, rank real)
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
    c.lesson_id,
    l.title AS lesson_title,
    c.id AS chunk_id,
    c.chunk_text,
    ts_rank_cd(c.search_vector, v_tsq) AS rank
  FROM public.lesson_chunks c
  JOIN public.lessons l ON l.id = c.lesson_id
  WHERE c.bootcamp_id = p_bootcamp_id
    AND l.status = 'published'
    AND c.search_vector @@ v_tsq
  ORDER BY rank DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 5), 20));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.search_published_lesson_chunks(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_published_lesson_chunks(uuid, text, integer) TO service_role;