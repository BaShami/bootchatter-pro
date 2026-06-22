
-- Fix invite insert policy: explicit bool_and that user is admin of every bootcamp_id
DROP POLICY IF EXISTS "Admins insert invites" ON public.invites;
CREATE POLICY "Admins insert invites" ON public.invites
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'platform_admin')
  OR (
    array_length(bootcamp_ids, 1) > 0
    AND COALESCE(
      (SELECT bool_and(public.is_bootcamp_admin(auth.uid(), bid)) FROM unnest(bootcamp_ids) AS bid),
      false
    )
  )
);

-- Restrict announcement update policies to authenticated role
DROP POLICY IF EXISTS "Teachers update announcements" ON public.announcements;
CREATE POLICY "Teachers update announcements"
  ON public.announcements
  FOR UPDATE
  TO authenticated
  USING (public.is_bootcamp_teacher(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

DROP POLICY IF EXISTS "Teachers update recipients" ON public.announcement_recipients;
CREATE POLICY "Teachers update recipients"
  ON public.announcement_recipients
  FOR UPDATE
  TO authenticated
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
