
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE public.app_role AS ENUM ('platform_admin');
CREATE TYPE public.bootcamp_role AS ENUM ('admin');
CREATE TYPE public.bootcamp_status AS ENUM ('draft', 'active', 'completed', 'archived');
CREATE TYPE public.enrollment_status AS ENUM ('invited', 'active', 'suspended', 'completed', 'removed');
CREATE TYPE public.consent_status AS ENUM ('pending', 'granted', 'revoked');
CREATE TYPE public.lesson_status AS ENUM ('draft', 'processing', 'ready', 'published', 'failed', 'archived');
CREATE TYPE public.announcement_status AS ENUM ('draft', 'scheduled', 'ready', 'processing', 'completed', 'cancelled');
CREATE TYPE public.announcement_audience AS ENUM ('all', 'specific');
CREATE TYPE public.recipient_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE public.review_status AS ENUM ('unreviewed', 'correct', 'incorrect', 'instructor_answered', 'unresolved');
CREATE TYPE public.announcement_method AS ENUM ('pull', 'push');

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id, NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  );
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ user_roles (platform-level) ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ bootcamps ============
CREATE TABLE public.bootcamps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  status public.bootcamp_status NOT NULL DEFAULT 'draft',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bootcamps TO authenticated;
GRANT ALL ON public.bootcamps TO service_role;
ALTER TABLE public.bootcamps ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_bootcamps_updated BEFORE UPDATE ON public.bootcamps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_bootcamps_status ON public.bootcamps(status);

-- ============ bootcamp_members ============
CREATE TABLE public.bootcamp_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.bootcamp_role NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bootcamp_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bootcamp_members TO authenticated;
GRANT ALL ON public.bootcamp_members TO service_role;
ALTER TABLE public.bootcamp_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_bootcamp_members_user ON public.bootcamp_members(user_id);
CREATE INDEX idx_bootcamp_members_bootcamp ON public.bootcamp_members(bootcamp_id);

-- Security-definer helpers (after bootcamp_members exists)
CREATE OR REPLACE FUNCTION public.is_bootcamp_member(_user_id UUID, _bootcamp_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bootcamp_members
    WHERE user_id = _user_id AND bootcamp_id = _bootcamp_id
  ) OR public.has_role(_user_id, 'platform_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_bootcamp_admin(_user_id UUID, _bootcamp_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bootcamp_members
    WHERE user_id = _user_id AND bootcamp_id = _bootcamp_id AND role = 'admin'
  ) OR public.has_role(_user_id, 'platform_admin')
$$;

-- profiles policies
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'platform_admin'));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Platform admin updates any profile" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin')) WITH CHECK (true);

-- user_roles policies
CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'platform_admin'));

-- bootcamps policies
CREATE POLICY "Members select bootcamps" ON public.bootcamps FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), id));
CREATE POLICY "Platform admin inserts bootcamps" ON public.bootcamps FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));
CREATE POLICY "Admins update bootcamps" ON public.bootcamps FOR UPDATE TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), id)) WITH CHECK (public.is_bootcamp_admin(auth.uid(), id));
CREATE POLICY "Platform admin deletes bootcamps" ON public.bootcamps FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- bootcamp_members policies
CREATE POLICY "Members see bootcamp members" ON public.bootcamp_members FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Platform admin manages members" ON public.bootcamp_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

-- ============ students ============
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone_number TEXT NOT NULL,
  enrollment_status public.enrollment_status NOT NULL DEFAULT 'invited',
  consent_status public.consent_status NOT NULL DEFAULT 'pending',
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bootcamp_id, phone_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_students_updated BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_students_phone ON public.students(phone_number);
CREATE INDEX idx_students_bootcamp ON public.students(bootcamp_id);
CREATE INDEX idx_students_status ON public.students(enrollment_status);
CREATE POLICY "Members read students" ON public.students FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Admins write students" ON public.students FOR ALL TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- ============ lessons ============
CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  lesson_number INTEGER,
  module_name TEXT,
  lesson_date DATE,
  status public.lesson_status NOT NULL DEFAULT 'draft',
  transcript TEXT,
  summary TEXT,
  learning_objectives TEXT,
  key_topics TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessons TO authenticated;
GRANT ALL ON public.lessons TO service_role;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_lessons_updated BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_lessons_bootcamp ON public.lessons(bootcamp_id);
CREATE INDEX idx_lessons_status ON public.lessons(status);
CREATE POLICY "Members read lessons" ON public.lessons FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Admins write lessons" ON public.lessons FOR ALL TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- ============ lesson_files ============
CREATE TABLE public.lesson_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_files TO authenticated;
GRANT ALL ON public.lesson_files TO service_role;
ALTER TABLE public.lesson_files ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_lesson_files_lesson ON public.lesson_files(lesson_id);
CREATE POLICY "Members read lesson files" ON public.lesson_files FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Admins write lesson files" ON public.lesson_files FOR ALL TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- ============ lesson_chunks ============
CREATE TABLE public.lesson_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_chunks TO authenticated;
GRANT ALL ON public.lesson_chunks TO service_role;
ALTER TABLE public.lesson_chunks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_lesson_chunks_lesson ON public.lesson_chunks(lesson_id);
CREATE INDEX idx_lesson_chunks_bootcamp ON public.lesson_chunks(bootcamp_id);
CREATE INDEX idx_lesson_chunks_embedding ON public.lesson_chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE POLICY "Members read chunks" ON public.lesson_chunks FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Admins write chunks" ON public.lesson_chunks FOR ALL TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- ============ announcements ============
CREATE TABLE public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience_type public.announcement_audience NOT NULL DEFAULT 'all',
  status public.announcement_status NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_announcements_updated BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_announcements_bootcamp ON public.announcements(bootcamp_id);
CREATE INDEX idx_announcements_status ON public.announcements(status);
CREATE POLICY "Members read announcements" ON public.announcements FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Admins write announcements" ON public.announcements FOR ALL TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- ============ announcement_recipients ============
CREATE TABLE public.announcement_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  processing_status public.recipient_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, student_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_recipients TO authenticated;
GRANT ALL ON public.announcement_recipients TO service_role;
ALTER TABLE public.announcement_recipients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_announcement_recipients_updated BEFORE UPDATE ON public.announcement_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Members read recipients" ON public.announcement_recipients FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_id AND public.is_bootcamp_member(auth.uid(), a.bootcamp_id)));
CREATE POLICY "Admins write recipients" ON public.announcement_recipients FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_id AND public.is_bootcamp_admin(auth.uid(), a.bootcamp_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_id AND public.is_bootcamp_admin(auth.uid(), a.bootcamp_id)));

-- ============ questions ============
CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  ai_answer TEXT,
  instructor_answer TEXT,
  external_message_id TEXT UNIQUE,
  confidence_score NUMERIC(5,4),
  referenced_lessons UUID[] DEFAULT '{}',
  retrieved_chunks JSONB DEFAULT '[]'::jsonb,
  review_status public.review_status NOT NULL DEFAULT 'unreviewed',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO authenticated;
GRANT ALL ON public.questions TO service_role;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_questions_bootcamp ON public.questions(bootcamp_id);
CREATE INDEX idx_questions_created ON public.questions(created_at DESC);
CREATE INDEX idx_questions_review ON public.questions(review_status);
CREATE POLICY "Members read questions" ON public.questions FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Admins write questions" ON public.questions FOR ALL TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- ============ bootcamp_settings ============
CREATE TABLE public.bootcamp_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID NOT NULL UNIQUE REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  ai_instructions TEXT,
  ai_model TEXT DEFAULT 'gpt-4o-mini',
  max_answer_length INTEGER DEFAULT 600,
  minimum_similarity NUMERIC(4,3) DEFAULT 0.7,
  retrieval_limit INTEGER DEFAULT 5,
  fallback_answer TEXT DEFAULT 'I could not find that answer in the available bootcamp lessons. Please ask your instructor.',
  make_webhook_url TEXT,
  announcement_method public.announcement_method NOT NULL DEFAULT 'pull',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bootcamp_settings TO authenticated;
GRANT ALL ON public.bootcamp_settings TO service_role;
ALTER TABLE public.bootcamp_settings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_bootcamp_settings_updated BEFORE UPDATE ON public.bootcamp_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Members read settings" ON public.bootcamp_settings FOR SELECT TO authenticated
  USING (public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Admins write settings" ON public.bootcamp_settings FOR ALL TO authenticated
  USING (public.is_bootcamp_admin(auth.uid(), bootcamp_id))
  WITH CHECK (public.is_bootcamp_admin(auth.uid(), bootcamp_id));

-- Auto-create settings row when bootcamp is created
CREATE OR REPLACE FUNCTION public.handle_new_bootcamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.bootcamp_settings (bootcamp_id) VALUES (NEW.id);
  RETURN NEW;
END; $$;
CREATE TRIGGER on_bootcamp_created AFTER INSERT ON public.bootcamps
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_bootcamp();

-- ============ activity_logs ============
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootcamp_id UUID REFERENCES public.bootcamps(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_activity_bootcamp ON public.activity_logs(bootcamp_id);
CREATE INDEX idx_activity_created ON public.activity_logs(created_at DESC);
CREATE POLICY "Members read logs" ON public.activity_logs FOR SELECT TO authenticated
  USING (bootcamp_id IS NULL AND public.has_role(auth.uid(), 'platform_admin')
         OR public.is_bootcamp_member(auth.uid(), bootcamp_id));
CREATE POLICY "Authenticated insert logs" ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
