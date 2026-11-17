CREATE OR REPLACE FUNCTION public.list_restore_days()
RETURNS TABLE (day date, pieces bigint, first_saved timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.day, count(*)::bigint, min(r.saved_at)
  FROM public.hospital_restore_points r
  GROUP BY r.day
  ORDER BY r.day DESC
  LIMIT 400;
$$;
REVOKE ALL ON FUNCTION public.list_restore_days() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_restore_days() TO service_role;