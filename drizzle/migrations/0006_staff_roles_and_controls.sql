ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lab_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'icu_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'radiologist';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS controls jsonb;
COMMENT ON COLUMN public.profiles.controls IS 'Per-person limits set by the director (e.g. maximum receipt discount without approval).';