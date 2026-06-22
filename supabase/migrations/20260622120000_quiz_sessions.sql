-- Quiz sessions for student SMS quiz flow
CREATE TABLE public.quiz_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  questions JSONB NOT NULL,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_question INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quiz_sessions_student ON public.quiz_sessions(student_id);
CREATE UNIQUE INDEX idx_quiz_sessions_active_per_lesson
  ON public.quiz_sessions (student_id, lesson_id)
  WHERE status = 'active';

GRANT SELECT ON public.quiz_sessions TO authenticated;
GRANT ALL ON public.quiz_sessions TO service_role;

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_quiz_sessions_updated
  BEFORE UPDATE ON public.quiz_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Members read quiz sessions" ON public.quiz_sessions
  FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
