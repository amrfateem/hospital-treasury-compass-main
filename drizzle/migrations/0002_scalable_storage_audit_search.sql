-- Hospital records split into small pieces (one per collection, and one per month for dated
-- records) so a change rewrites only the piece it touched, and devices download only changes.
CREATE TABLE public.hospital_chunks (
  key text PRIMARY KEY,
  data jsonb,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hospital_chunks_version_idx ON public.hospital_chunks (version);
GRANT ALL ON public.hospital_chunks TO service_role;
ALTER TABLE public.hospital_chunks ENABLE ROW LEVEL SECURITY;

-- Full, permanent audit history (the live document keeps only the latest entries).
CREATE TABLE public.audit_log (
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  by_name text NOT NULL DEFAULT '',
  by_id uuid,
  role text NOT NULL DEFAULT '',
  op text NOT NULL,
  section text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  version bigint NOT NULL
);
CREATE INDEX audit_log_at_idx ON public.audit_log (at DESC);
CREATE INDEX audit_log_by_idx ON public.audit_log (by_id, at DESC);
CREATE INDEX audit_log_section_idx ON public.audit_log (section, at DESC);
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Saves changed pieces atomically: only if nobody saved in between (version check).
CREATE OR REPLACE FUNCTION public.save_hospital_chunks(_expected bigint, _chunks jsonb, _audit jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v bigint;
BEGIN
  UPDATE public.hospital_state_meta SET version = version + 1, updated_at = now()
    WHERE id = 1 AND version = _expected
    RETURNING version INTO _v;
  IF _v IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.hospital_chunks (key, data, version, updated_at)
    SELECT e.key, CASE WHEN jsonb_typeof(e.value) = 'null' THEN NULL ELSE e.value END, _v, now()
    FROM jsonb_each(COALESCE(_chunks, '{}'::jsonb)) AS e
  ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = now();
  IF _audit IS NOT NULL AND jsonb_typeof(_audit) = 'array' THEN
    INSERT INTO public.audit_log (id, at, by_name, by_id, role, op, section, summary, version)
      SELECT a->>'id', to_timestamp((a->>'at')::double precision / 1000), COALESCE(a->>'by', ''),
             NULLIF(a->>'byId', '')::uuid, COALESCE(a->>'role', ''), a->>'op',
             COALESCE(a->>'section', ''), COALESCE(a->>'summary', ''), _v
      FROM jsonb_array_elements(_audit) AS a
    ON CONFLICT (id) DO NOTHING;
  END IF;
  UPDATE public.hospital_state SET version = _v, updated_at = now() WHERE id = 1;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION public.save_hospital_chunks(bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_hospital_chunks(bigint, jsonb, jsonb) TO service_role;

-- Fast "contains" search on patient files even with millions of patients.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX patients_name_trgm_idx ON public.patients USING gin (full_name extensions.gin_trgm_ops);
CREATE INDEX patients_phone_trgm_idx ON public.patients USING gin (phone extensions.gin_trgm_ops);
CREATE INDEX patients_mrn_trgm_idx ON public.patients USING gin (mrn extensions.gin_trgm_ops);
CREATE INDEX patients_nid_trgm_idx ON public.patients USING gin (national_id extensions.gin_trgm_ops);
CREATE UNIQUE INDEX patients_nid_unique ON public.patients (national_id) WHERE national_id IS NOT NULL;
CREATE INDEX patients_created_idx ON public.patients (created_at DESC);
CREATE INDEX stored_files_ref_idx ON public.stored_files (owner_kind, owner_id, kind, ref_id);