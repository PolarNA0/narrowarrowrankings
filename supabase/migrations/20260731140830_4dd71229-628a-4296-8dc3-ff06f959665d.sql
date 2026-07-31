CREATE TABLE public.player_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE,
  display_name text,
  avatar_url text,
  banner_url text,
  accent_color text,
  bio text,
  country text,
  socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.player_profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_profiles TO authenticated;
GRANT ALL ON public.player_profiles TO service_role;

ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are public" ON public.player_profiles FOR SELECT USING (true);
CREATE POLICY "Users create own profile" ON public.player_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.player_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage profiles" ON public.player_profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.profile_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_username text NOT NULL,
  proof_url text,
  note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.profile_link_requests TO authenticated;
GRANT UPDATE, DELETE ON public.profile_link_requests TO authenticated;
GRANT ALL ON public.profile_link_requests TO service_role;

ALTER TABLE public.profile_link_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own requests" ON public.profile_link_requests FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create own requests" ON public.profile_link_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "Admins review requests" ON public.profile_link_requests FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete requests" ON public.profile_link_requests FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);

-- Only admins may set the linked username or verified flag.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.username := NULL;
    NEW.verified := false;
  ELSE
    NEW.username := OLD.username;
    NEW.verified := OLD.verified;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_player_profiles_privileged
BEFORE INSERT OR UPDATE ON public.player_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_fields();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER touch_player_profiles BEFORE UPDATE ON public.player_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER touch_profile_link_requests BEFORE UPDATE ON public.profile_link_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();