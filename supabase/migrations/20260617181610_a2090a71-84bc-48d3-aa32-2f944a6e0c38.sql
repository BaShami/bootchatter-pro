
-- Vector search RPC: returns top-N matching chunks from PUBLISHED lessons in a bootcamp.
CREATE OR REPLACE FUNCTION public.match_lesson_chunks(
  query_embedding vector(1536),
  p_bootcamp_id uuid,
  match_count int DEFAULT 6,
  min_similarity float DEFAULT 0.0
)
RETURNS TABLE (
  chunk_id uuid,
  lesson_id uuid,
  lesson_title text,
  chunk_index int,
  chunk_text text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    c.lesson_id,
    l.title AS lesson_title,
    c.chunk_index,
    c.chunk_text,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.lesson_chunks c
  JOIN public.lessons l ON l.id = c.lesson_id
  WHERE c.bootcamp_id = p_bootcamp_id
    AND l.status = 'published'
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= min_similarity
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_lesson_chunks(vector, uuid, int, float) TO service_role, authenticated;

-- Storage policies for the private lesson-files bucket.
-- Path convention used by the app: <bootcamp_id>/<lesson_id>/<filename>
CREATE POLICY "Bootcamp admins read lesson files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND public.is_bootcamp_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Bootcamp admins upload lesson files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-files'
    AND public.is_bootcamp_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Bootcamp admins update lesson files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND public.is_bootcamp_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Bootcamp admins delete lesson files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND public.is_bootcamp_admin(auth.uid(), (storage.foldername(name))[1]::uuid)
  );
