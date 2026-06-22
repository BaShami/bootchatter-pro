
CREATE TABLE public.escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id uuid NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  summary text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalations TO authenticated;
GRANT ALL ON public.escalations TO service_role;

ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view escalations"
  ON public.escalations FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));

CREATE POLICY "Members can insert escalations"
  ON public.escalations FOR INSERT TO authenticated
  WITH CHECK (public.is_bootcamp_member(auth.uid(), bootcamp_id));

CREATE POLICY "Teachers can update escalations"
  ON public.escalations FOR UPDATE TO authenticated
  USING (public.is_bootcamp_teacher(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_teacher(auth.uid(), bootcamp_id));

CREATE POLICY "Admins can delete escalations"
  ON public.escalations FOR DELETE TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

CREATE INDEX idx_escalations_bootcamp_status ON public.escalations(bootcamp_id, status);
CREATE INDEX idx_escalations_student ON public.escalations(student_id);

CREATE TRIGGER set_escalations_updated_at
  BEFORE UPDATE ON public.escalations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
