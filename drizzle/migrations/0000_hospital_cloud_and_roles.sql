CREATE TYPE public.app_role AS ENUM ('admin', 'finance', 'reception', 'auditor');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  box_id text,
  active boolean NOT NULL DEFAULT true,
  permissions jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.hospital_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.hospital_state TO service_role;
ALTER TABLE public.hospital_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.hospital_state_meta (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hospital_state_meta TO authenticated;
GRANT ALL ON public.hospital_state_meta TO service_role;
ALTER TABLE public.hospital_state_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in staff read version" ON public.hospital_state_meta FOR SELECT TO authenticated USING (true);

INSERT INTO public.hospital_state (id, data, version) VALUES (1, '{}'::jsonb, 0);
INSERT INTO public.hospital_state_meta (id, version) VALUES (1, 0);

CREATE OR REPLACE FUNCTION public.save_hospital_state(_expected bigint, _data jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v bigint;
BEGIN
  UPDATE public.hospital_state SET data = _data, version = version + 1, updated_at = now()
    WHERE id = 1 AND version = _expected
    RETURNING version INTO _v;
  IF _v IS NULL THEN RETURN NULL; END IF;
  UPDATE public.hospital_state_meta SET version = _v, updated_at = now() WHERE id = 1;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION public.save_hospital_state(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_hospital_state(bigint, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

ALTER PUBLICATION supabase_realtime ADD TABLE public.hospital_state_meta;