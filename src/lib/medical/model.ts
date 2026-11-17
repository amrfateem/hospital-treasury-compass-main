/** Medical records (patients, appointments, visits, lab). Stored in their own tables. */
export type Gender = "male" | "female";
export type AppointmentStatus = "booked" | "arrived" | "done" | "cancelled" | "no_show";
export type LabStatus = "ordered" | "in_progress" | "done" | "cancelled";

export interface Patient {
  id: string;
  mrn: string;
  fullName: string;
  nationalId: string | null;
  birthDate: string | null;
  gender: Gender | null;
  phone: string | null;
  address: string | null;
  bloodType: string | null;
  allergies: string | null;
  chronicConditions: string | null;
  emergencyContact: string | null;
  notes: string | null;
  createdAt: string;
}
export type PatientInput = Omit<Patient, "id" | "mrn" | "createdAt"> & { id?: string | undefined };

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientPhone: string | null;
  doctorId: string | null;
  department: string;
  startsAt: string;
  durationMin: number;
  status: AppointmentStatus;
  reason: string | null;
  notes: string | null;
}
export type AppointmentInput = Pick<Appointment, "patientId" | "doctorId" | "department" | "startsAt" | "durationMin" | "reason" | "notes"> & {
  id?: string | undefined;
};

export interface Vitals {
  bp?: string;
  pulse?: number;
  temp?: number;
  weight?: number;
  spo2?: number;
}
export interface Visit {
  id: string;
  patientId: string;
  visitDate: string;
  department: string;
  doctorId: string | null;
  complaint: string | null;
  diagnosis: string | null;
  prescription: string | null;
  notes: string | null;
  vitals: Vitals;
}
export type VisitInput = Omit<Visit, "id"> & { id?: string | undefined };

export interface LabTest {
  name: string;
  result: string;
  unit: string;
  range: string;
}
export interface LabOrder {
  id: string;
  orderNo: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string | null;
  orderedAt: string;
  status: LabStatus;
  tests: LabTest[];
  notes: string | null;
  resultAt: string | null;
}
export type LabOrderInput = Pick<LabOrder, "patientId" | "doctorId" | "tests" | "notes"> & {
  id?: string | undefined;
  status?: LabStatus | undefined;
};

export const APPOINTMENT_STATUS: Record<AppointmentStatus, string> = {
  booked: "محجوز",
  arrived: "وصل",
  done: "تم الكشف",
  cancelled: "ملغي",
  no_show: "لم يحضر",
};
export const LAB_STATUS: Record<LabStatus, string> = {
  ordered: "مطلوب",
  in_progress: "جارٍ التحليل",
  done: "النتيجة جاهزة",
  cancelled: "ملغي",
};
export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/** Common tests with adult reference ranges — suggestions only, every value stays editable. */
export const LAB_PRESETS: Omit<LabTest, "result">[] = [
  { name: "هيموجلوبين (Hb)", unit: "g/dL", range: "12-17" },
  { name: "كرات الدم البيضاء (WBC)", unit: "10³/µL", range: "4-11" },
  { name: "الصفائح الدموية (PLT)", unit: "10³/µL", range: "150-450" },
  { name: "سكر صائم", unit: "mg/dL", range: "70-100" },
  { name: "سكر عشوائي", unit: "mg/dL", range: "70-140" },
  { name: "السكر التراكمي (HbA1c)", unit: "%", range: "4-5.6" },
  { name: "كرياتينين", unit: "mg/dL", range: "0.6-1.3" },
  { name: "يوريا", unit: "mg/dL", range: "15-45" },
  { name: "إنزيم ALT", unit: "U/L", range: "0-41" },
  { name: "إنزيم AST", unit: "U/L", range: "0-40" },
  { name: "كوليسترول كلي", unit: "mg/dL", range: "0-200" },
  { name: "دهون ثلاثية", unit: "mg/dL", range: "0-150" },
  { name: "هرمون الغدة (TSH)", unit: "mIU/L", range: "0.4-4" },
  { name: "حمض اليوريك", unit: "mg/dL", range: "3.5-7.2" },
];

/** "low" / "high" / "normal" for a numeric result against a "min-max" range; null when not comparable. */
export function labFlag(result: string, range: string): "low" | "high" | "normal" | null {
  const v = Number(result.replace(",", "."));
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(range);
  if (!result.trim() || Number.isNaN(v) || !m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return v < lo ? "low" : v > hi ? "high" : "normal";
}

/** A lab order is done once every test has a result. */
export const labComplete = (tests: LabTest[]) => tests.length > 0 && tests.every((t) => t.result.trim() !== "");
