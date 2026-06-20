
CREATE OR REPLACE FUNCTION public.is_bootcamp_teacher(_user_id uuid, _bootcamp_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bootcamp_members
    WHERE user_id = _user_id AND bootcamp_id = _bootcamp_id AND role = 'teacher'
  ) OR public.is_bootcamp_admin(_user_id, _bootcamp_id)
$$;

CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  bootcamp_ids uuid[] NOT NULL CHECK (array_length(bootcamp_ids, 1) >= 1),
  role public.bootcamp_role NOT NULL DEFAULT 'teacher',
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read invites" ON public.invites
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin')
  OR EXISTS (SELECT 1 FROM unnest(bootcamp_ids) AS bid WHERE public.is_bootcamp_admin(auth.uid(), bid))
);

CREATE POLICY "Admins insert invites" ON public.invites
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'platform_admin')
  OR NOT EXISTS (
    SELECT 1 FROM unnest(bootcamp_ids) AS bid
    WHERE NOT public.is_bootcamp_admin(auth.uid(), bid)
  )
);

CREATE POLICY "Admins update invites" ON public.invites
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin')
  OR EXISTS (SELECT 1 FROM unnest(bootcamp_ids) AS bid WHERE public.is_bootcamp_admin(auth.uid(), bid))
)
WITH CHECK (
  public.has_role(auth.uid(), 'platform_admin')
  OR EXISTS (SELECT 1 FROM unnest(bootcamp_ids) AS bid WHERE public.is_bootcamp_admin(auth.uid(), bid))
);

CREATE OR REPLACE FUNCTION public.get_invite_by_token(_token uuid)
RETURNS TABLE (
  id uuid,
  email text,
  bootcamp_ids uuid[],
  bootcamp_names text[],
  status text,
  expires_at timestamptz,
  expired boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    i.id,
    i.email,
    i.bootcamp_ids,
    (SELECT array_agg(b.name ORDER BY b.name) FROM public.bootcamps b WHERE b.id = ANY(i.bootcamp_ids)) AS bootcamp_names,
    i.status,
    i.expires_at,
    (i.expires_at < now()) AS expired
  FROM public.invites i
  WHERE i.token = _token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_invite_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(uuid) TO anon, authenticated;

CREATE TABLE public.password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  actioned_at timestamptz,
  actioned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','actioned','cancelled'))
);

GRANT SELECT, INSERT, UPDATE ON public.password_reset_requests TO authenticated;
GRANT INSERT ON public.password_reset_requests TO anon;
GRANT ALL ON public.password_reset_requests TO service_role;

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can request reset" ON public.password_reset_requests
FOR INSERT TO anon, authenticated
WITH CHECK (status = 'pending' AND actioned_at IS NULL AND actioned_by IS NULL);

CREATE POLICY "Platform admins read reset queue" ON public.password_reset_requests
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'));

CREATE POLICY "Platform admins update reset queue" ON public.password_reset_requests
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'))
WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_reset_token uuid,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;

CREATE POLICY "Teachers insert lessons" ON public.lessons
FOR INSERT TO authenticated
WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

CREATE POLICY "Teachers update lessons" ON public.lessons
FOR UPDATE TO authenticated
USING (public.is_bootcamp_teacher(auth.uid(), bootcamp_id))
WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

CREATE POLICY "Teachers insert lesson files" ON public.lesson_files
FOR INSERT TO authenticated
WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

CREATE POLICY "Teachers update lesson files" ON public.lesson_files
FOR UPDATE TO authenticated
USING (public.is_bootcamp_teacher(auth.uid(), bootcamp_id))
WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

CREATE POLICY "Teachers insert announcements" ON public.announcements
FOR INSERT TO authenticated
WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

CREATE POLICY "Teachers insert recipients" ON public.announcement_recipients
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_recipients.announcement_id
      AND public.is_bootcamp_teacher(auth.uid(), a.bootcamp_id)
  )
);
