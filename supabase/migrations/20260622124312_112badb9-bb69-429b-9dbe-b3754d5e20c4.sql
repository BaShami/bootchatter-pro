
CREATE TABLE public.kb_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('operational', 'reference')),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  extracted_text TEXT,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_articles TO authenticated;
GRANT ALL ON public.kb_articles TO service_role;

ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bootcamp members can view active kb_articles"
ON public.kb_articles FOR SELECT
TO authenticated
USING (deleted_at IS NULL AND public.is_bootcamp_member(auth.uid(), bootcamp_id));

CREATE POLICY "Bootcamp admins can insert kb_articles"
ON public.kb_articles FOR INSERT
TO authenticated
WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

CREATE POLICY "Bootcamp admins can update kb_articles"
ON public.kb_articles FOR UPDATE
TO authenticated
USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

CREATE INDEX idx_kb_articles_bootcamp_active ON public.kb_articles(bootcamp_id) WHERE deleted_at IS NULL;

CREATE TRIGGER kb_articles_set_updated_at
BEFORE UPDATE ON public.kb_articles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage RLS for kb-files bucket (bucket created via tool separately).
CREATE POLICY "Bootcamp members can read kb-files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'kb-files'
  AND public.is_bootcamp_member(auth.uid(), (split_part(name, '/', 1))::uuid)
);

CREATE POLICY "Bootcamp admins can upload kb-files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'kb-files'
  AND public.is_bootcamp_admin(auth.uid(), (split_part(name, '/', 1))::uuid)
);

CREATE POLICY "Bootcamp admins can update kb-files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'kb-files'
  AND public.is_bootcamp_admin(auth.uid(), (split_part(name, '/', 1))::uuid)
);

CREATE POLICY "Bootcamp admins can delete kb-files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'kb-files'
  AND public.is_bootcamp_admin(auth.uid(), (split_part(name, '/', 1))::uuid)
);
