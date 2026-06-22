ALTER TABLE public.lesson_files
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_lesson_files_active ON public.lesson_files(lesson_id) WHERE deleted_at IS NULL;