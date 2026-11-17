CREATE SEQUENCE IF NOT EXISTS public.patient_mrn_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.lab_order_seq START 1;

CREATE TABLE public.stored_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind text NOT NULL CHECK (owner_kind IN ('employee','patient')),
  owner_id text NOT NULL,
  kind text NOT NULL,
  ref_id text,
  path text NOT NULL UNIQUE,
  file_name text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stored_files_owner_idx ON public.stored_files (owner_kind, owner_id);
GRANT ALL ON public.stored_files TO service_role;
ALTER TABLE public.stored_files ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn text NOT NULL UNIQUE DEFAULT ('MRN-' || lpad(nextval('public.patient_mrn_seq')::text, 6, '0')),
  full_name text NOT NULL,
  national_id text,
  birth_date date,
  gender text CHECK (gender IN ('male','female')),
  phone text,
  address text,
  blood_type text,
  allergies text,
  chronic_conditions text,
  emergency_contact text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_name_idx ON public.patients (full_name);
CREATE INDEX patients_phone_idx ON public.patients (phone);
CREATE INDEX patients_nid_idx ON public.patients (national_id);
GRANT ALL ON public.patients TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.patient_mrn_seq TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id text,
  department text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 15 CHECK (duration_min > 0 AND duration_min <= 600),
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','arrived','done','cancelled','no_show')),
  reason text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_time_idx ON public.appointments (starts_at);
CREATE INDEX appointments_patient_idx ON public.appointments (patient_id);
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.medical_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_date date NOT NULL DEFAULT current_date,
  department text NOT NULL DEFAULT '',
  doctor_id text,
  complaint text,
  diagnosis text,
  prescription text,
  notes text,
  vitals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medical_visits_patient_idx ON public.medical_visits (patient_id, visit_date DESC);
GRANT ALL ON public.medical_visits TO service_role;
ALTER TABLE public.medical_visits ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE DEFAULT ('LAB-' || lpad(nextval('public.lab_order_seq')::text, 6, '0')),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id text,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','in_progress','done','cancelled')),
  tests jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  result_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_orders_patient_idx ON public.lab_orders (patient_id, ordered_at DESC);
CREATE INDEX lab_orders_status_idx ON public.lab_orders (status, ordered_at DESC);
GRANT ALL ON public.lab_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lab_order_seq TO service_role;
ALTER TABLE public.lab_orders ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER patients_touch BEFORE UPDATE ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();