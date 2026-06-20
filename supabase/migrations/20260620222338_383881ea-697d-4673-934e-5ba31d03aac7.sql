
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS webhook_payload jsonb,
  ADD COLUMN IF NOT EXISTS delivered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0;

CREATE POLICY "Teachers update announcements"
  ON public.announcements
  FOR UPDATE
  USING (public.is_bootcamp_teacher(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

CREATE POLICY "Teachers update recipients"
  ON public.announcement_recipients
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_recipients.announcement_id
      AND public.is_bootcamp_teacher(auth.uid(), a.bootcamp_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_recipients.announcement_id
      AND public.is_bootcamp_teacher(auth.uid(), a.bootcamp_id)
  ));
