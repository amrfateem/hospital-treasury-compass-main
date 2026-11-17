CREATE TABLE public.hospital_restore_points (
  day date NOT NULL,
  key text NOT NULL,
  data jsonb,
  version bigint NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, key)
);
CREATE INDEX hospital_restore_points_day_idx ON public.hospital_restore_points (day DESC);
GRANT ALL ON public.hospital_restore_points TO service_role;
ALTER TABLE public.hospital_restore_points ENABLE ROW LEVEL SECURITY;

-- Before a piece changes for the first time today, keep how it looked (start-of-day copy).
CREATE OR REPLACE FUNCTION public.keep_restore_point()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.data IS DISTINCT FROM NEW.data THEN
    INSERT INTO public.hospital_restore_points (day, key, data, version)
      VALUES ((now() AT TIME ZONE 'Africa/Cairo')::date, OLD.key, OLD.data, OLD.version)
    ON CONFLICT (day, key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_restore_point() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER hospital_chunks_restore_point
BEFORE UPDATE ON public.hospital_chunks
FOR EACH ROW EXECUTE FUNCTION public.keep_restore_point();

-- Restore the whole hospital document to how it was at the start of a given day.
CREATE OR REPLACE FUNCTION public.restore_hospital_to_day(_day date)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v bigint;
BEGIN
  UPDATE public.hospital_state_meta SET version = version + 1, updated_at = now()
    WHERE id = 1 RETURNING version INTO _v;
  -- For every piece, pick the earliest copy taken on or after that day; that copy is
  -- how the piece looked at the start of _day. Pieces untouched since then stay as they are.
  WITH firsts AS (
    SELECT DISTINCT ON (key) key, data
    FROM public.hospital_restore_points
    WHERE day >= _day
    ORDER BY key, day ASC
  )
  UPDATE public.hospital_chunks c
    SET data = f.data, version = _v, updated_at = now()
    FROM firsts f WHERE c.key = f.key;
  -- Pieces created after that day did not exist yet: clear them.
  UPDATE public.hospital_chunks c
    SET data = NULL, version = _v, updated_at = now()
    WHERE c.data IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.hospital_restore_points r WHERE r.key = c.key AND r.day >= _day)
      AND (c.updated_at AT TIME ZONE 'Africa/Cairo')::date >= _day
      AND NOT EXISTS (SELECT 1 FROM public.hospital_restore_points r2 WHERE r2.key = c.key);
  UPDATE public.hospital_state SET version = _v, updated_at = now() WHERE id = 1;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION public.restore_hospital_to_day(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_hospital_to_day(date) TO service_role;

-- Keep a year of daily restore points.
CREATE OR REPLACE FUNCTION public.prune_restore_points()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.hospital_restore_points WHERE day < (now() AT TIME ZONE 'Africa/Cairo')::date - 366;
$$;
REVOKE ALL ON FUNCTION public.prune_restore_points() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_restore_points() TO service_role;