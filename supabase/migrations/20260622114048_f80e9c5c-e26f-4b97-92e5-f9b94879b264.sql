ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lessons_active ON public.lessons (bootcamp_id) WHERE deleted_at IS NULL;