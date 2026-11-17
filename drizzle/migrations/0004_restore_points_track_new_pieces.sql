CREATE OR REPLACE FUNCTION public.keep_restore_point_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.hospital_restore_points (day, key, data, version)
    VALUES ((now() AT TIME ZONE 'Africa/Cairo')::date, NEW.key, NULL, 0)
  ON CONFLICT (day, key) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_restore_point_on_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER hospital_chunks_restore_point_insert
AFTER INSERT ON public.hospital_chunks
FOR EACH ROW EXECUTE FUNCTION public.keep_restore_point_on_insert();

CREATE OR REPLACE FUNCTION public.restore_hospital_to_day(_day date)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v bigint;
BEGIN
  UPDATE public.hospital_state_meta SET version = version + 1, updated_at = now()
    WHERE id = 1 RETURNING version INTO _v;
  -- For every piece, the earliest copy taken on or after _day is how it looked at the start
  -- of _day (NULL when it did not exist yet). Pieces untouched since then stay as they are.
  WITH firsts AS (
    SELECT DISTINCT ON (key) key, data
    FROM public.hospital_restore_points
    WHERE day >= _day
    ORDER BY key, day ASC
  )
  UPDATE public.hospital_chunks c
    SET data = f.data, version = _v, updated_at = now()
    FROM firsts f WHERE c.key = f.key;
  UPDATE public.hospital_state SET version = _v, updated_at = now() WHERE id = 1;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION public.restore_hospital_to_day(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_hospital_to_day(date) TO service_role;