CREATE OR REPLACE FUNCTION public.is_active_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE p.id = _user_id AND p.active
  )
$$;

REVOKE ALL ON FUNCTION public.is_active_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_staff(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Signed-in staff read version" ON public.hospital_state_meta;
CREATE POLICY "Active staff read version" ON public.hospital_state_meta
  FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()));