ALTER TABLE public.bootcamp_settings
  ADD COLUMN IF NOT EXISTS student_onboarding_webhook_url text;
