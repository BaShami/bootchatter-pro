ALTER TABLE public.escalations
  ADD COLUMN IF NOT EXISTS trigger_message text;
