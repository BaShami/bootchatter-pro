-- Member status for bootcamp_members (active vs suspended)
ALTER TABLE public.bootcamp_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended'));

-- History of suspended / removed teachers
CREATE TABLE IF NOT EXISTS public.teacher_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id uuid NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  first_name text,
  last_name text,
  role public.bootcamp_role NOT NULL,
  action text NOT NULL CHECK (action IN ('suspended', 'removed')),
  actioned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actioned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teacher_history_bootcamp ON public.teacher_history(bootcamp_id);

GRANT SELECT, INSERT ON public.teacher_history TO authenticated;
GRANT ALL ON public.teacher_history TO service_role;

ALTER TABLE public.teacher_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bootcamp admins read teacher history" ON public.teacher_history
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin')
  OR public.is_bootcamp_admin(auth.uid(), bootcamp_id)
);

CREATE POLICY "Bootcamp admins insert teacher history" ON public.teacher_history
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'platform_admin')
  OR public.is_bootcamp_admin(auth.uid(), bootcamp_id)
);

-- Bootcamp admins can suspend/remove teacher members
CREATE POLICY "Bootcamp admins manage teacher members" ON public.bootcamp_members
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin')
  OR (public.is_bootcamp_admin(auth.uid(), bootcamp_id) AND role = 'teacher')
)
WITH CHECK (
  public.has_role(auth.uid(), 'platform_admin')
  OR (public.is_bootcamp_admin(auth.uid(), bootcamp_id) AND role = 'teacher')
);
