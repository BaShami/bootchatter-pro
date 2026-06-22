-- Ensure bootcamp admins can soft-delete kb_articles (set deleted_at).
DROP POLICY IF EXISTS "Bootcamp admins can update kb_articles" ON public.kb_articles;
DROP POLICY IF EXISTS "Admins update kb_articles" ON public.kb_articles;

CREATE POLICY "Admins update kb_articles" ON public.kb_articles
  FOR UPDATE TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- Admins need SELECT on rows they manage (including soft-delete target lookup).
DROP POLICY IF EXISTS "Admins read kb_articles" ON public.kb_articles;

CREATE POLICY "Admins read kb_articles" ON public.kb_articles
  FOR SELECT TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id));
