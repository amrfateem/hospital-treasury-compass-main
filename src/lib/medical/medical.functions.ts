/**
 * Medical records live in their own tables (not the finance JSON document) so they scale.
 * Tables have RLS with no policies; these functions check the caller's section and then use
 * the service client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireLevel } from "@/lib/hospital/access";
import type { Database } from "@/integrations/supabase/types";
import { labComplete, type Appointment, type LabOrder, type Patient, type Visit } from "./model";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
const text = (max = 500) => z.string().max(max).nullable().transform((v) => (v && v.trim() ? v.trim() : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const toPatient = (r: Row<"patients">): Patient => ({
  id: r.id,
  mrn: r.mrn,
  fullName: r.full_name,
  nationalId: r.national_id,
  birthDate: r.birth_date,
  gender: (r.gender as Patient["gender"]) ?? null,
  phone: r.phone,
  address: r.address,
  bloodType: r.blood_type,
  allergies: r.allergies,
  chronicConditions: r.chronic_conditions,
  emergencyContact: r.emergency_contact,
  notes: r.notes,
  createdAt: r.created_at,
});
type PatientRef = { full_name: string; mrn: string; phone: string | null } | null;
const toAppointment = (r: Row<"appointments"> & { patients: PatientRef }): Appointment => ({
  id: r.id,
  patientId: r.patient_id,
  patientName: r.patients?.full_name ?? "",
  patientMrn: r.patients?.mrn ?? "",
  patientPhone: r.patients?.phone ?? null,
  doctorId: r.doctor_id,
  department: r.department,
  startsAt: r.starts_at,
  durationMin: r.duration_min,
  status: r.status as Appointment["status"],
  reason: r.reason,
  notes: r.notes,
});
const toVisit = (r: Row<"medical_visits">): Visit => ({
  id: r.id,
  patientId: r.patient_id,
  visitDate: r.visit_date,
  department: r.department,
  doctorId: r.doctor_id,
  complaint: r.complaint,
  diagnosis: r.diagnosis,
  prescription: r.prescription,
  notes: r.notes,
  vitals: (r.vitals ?? {}) as Visit["vitals"],
});
const toLab = (r: Row<"lab_orders"> & { patients: PatientRef }): LabOrder => ({
  id: r.id,
  orderNo: r.order_no,
  patientId: r.patient_id,
  patientName: r.patients?.full_name ?? "",
  patientMrn: r.patients?.mrn ?? "",
  doctorId: r.doctor_id,
  orderedAt: r.ordered_at,
  status: r.status as LabOrder["status"],
  tests: (Array.isArray(r.tests) ? r.tests : []) as unknown as LabOrder["tests"],
  notes: r.notes,
  resultAt: r.result_at,
});
const PATIENT_REF = "patients(full_name, mrn, phone)";

/* ---------------- Patients ---------------- */

export const searchPatients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().max(80).default(""), limit: z.number().int().min(1).max(100).default(30) }).parse(d))
  .handler(async ({ data, context }): Promise<Patient[]> => {
    await requireLevel(context, "patients", "view");
    const db = await admin();
    let query = db.from("patients").select("*").order("created_at", { ascending: false }).limit(data.limit);
    const q = data.q.trim().replace(/[%,()*]/g, " ");
    if (q) query = query.or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,phone.ilike.%${q}%,national_id.ilike.%${q}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error("تعذر البحث عن المرضى.");
    return rows.map(toPatient);
  });

/** Patient picker for appointments and lab: needs any of the three medical sections. */
export const findPatientsForBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().max(80), section: z.enum(["appointments", "lab"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireLevel(context, data.section, "add");
    const db = await admin();
    const q = data.q.trim().replace(/[%,()*]/g, " ");
    if (!q) return [];
    const { data: rows } = await db
      .from("patients")
      .select("id, mrn, full_name, phone")
      .or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(15);
    return (rows ?? []).map((r) => ({ id: r.id, mrn: r.mrn, fullName: r.full_name, phone: r.phone }));
  });

export const getPatientFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireLevel(context, "patients", "view");
    const db = await admin();
    const [p, v, a, l] = await Promise.all([
      db.from("patients").select("*").eq("id", data.id).maybeSingle(),
      db.from("medical_visits").select("*").eq("patient_id", data.id).order("visit_date", { ascending: false }).limit(200),
      db.from("appointments").select(`*, ${PATIENT_REF}`).eq("patient_id", data.id).order("starts_at", { ascending: false }).limit(100),
      db.from("lab_orders").select(`*, ${PATIENT_REF}`).eq("patient_id", data.id).order("ordered_at", { ascending: false }).limit(100),
    ]);
    if (!p.data) throw new Error("الملف غير موجود.");
    return {
      patient: toPatient(p.data),
      visits: (v.data ?? []).map(toVisit),
      appointments: (a.data ?? []).map((r) => toAppointment(r as never)),
      labOrders: (l.data ?? []).map((r) => toLab(r as never)),
    };
  });

const PatientSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(2).max(120),
  nationalId: z.string().regex(/^\d{14}$/).nullable(),
  birthDate: isoDate.nullable(),
  gender: z.enum(["male", "female"]).nullable(),
  phone: text(30),
  address: text(200),
  bloodType: text(4),
  allergies: text(),
  chronicConditions: text(),
  emergencyContact: text(150),
  notes: text(1000),
});

export const savePatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PatientSchema.parse(d))
  .handler(async ({ data, context }): Promise<Patient> => {
    await requireLevel(context, "patients", data.id ? "edit" : "add");
    const db = await admin();
    if (data.nationalId) {
      const { data: dup } = await db.from("patients").select("id, mrn").eq("national_id", data.nationalId).neq("id", data.id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
      if (dup) throw new Error(`هذا الرقم القومي مسجل بالفعل في الملف ${dup.mrn}.`);
    }
    const row = {
      full_name: data.fullName,
      national_id: data.nationalId,
      birth_date: data.birthDate,
      gender: data.gender,
      phone: data.phone,
      address: data.address,
      blood_type: data.bloodType,
      allergies: data.allergies,
      chronic_conditions: data.chronicConditions,
      emergency_contact: data.emergencyContact,
      notes: data.notes,
    };
    const res = data.id
      ? await db.from("patients").update(row).eq("id", data.id).select("*").single()
      : await db.from("patients").insert({ ...row, created_by: context.userId }).select("*").single();
    if (res.error) throw new Error("تعذر حفظ ملف المريض.");
    return toPatient(res.data);
  });

/* ---------------- Visits ---------------- */

const VitalsSchema = z
  .object({
    bp: z.string().max(10).optional(),
    pulse: z.number().min(0).max(300).optional(),
    temp: z.number().min(25).max(45).optional(),
    weight: z.number().min(0).max(400).optional(),
    spo2: z.number().min(0).max(100).optional(),
  })
  .default({});

export const saveVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        patientId: z.string().uuid(),
        visitDate: isoDate,
        department: z.string().max(60),
        doctorId: z.string().max(64).nullable(),
        complaint: text(1000),
        diagnosis: text(1000),
        prescription: text(2000),
        notes: text(2000),
        vitals: VitalsSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<Visit> => {
    await requireLevel(context, "patients", data.id ? "edit" : "add");
    const db = await admin();
    const row = {
      patient_id: data.patientId,
      visit_date: data.visitDate,
      department: data.department,
      doctor_id: data.doctorId,
      complaint: data.complaint,
      diagnosis: data.diagnosis,
      prescription: data.prescription,
      notes: data.notes,
      vitals: data.vitals,
    };
    const res = data.id
      ? await db.from("medical_visits").update(row).eq("id", data.id).select("*").single()
      : await db.from("medical_visits").insert({ ...row, created_by: context.userId }).select("*").single();
    if (res.error) throw new Error("تعذر حفظ الزيارة.");
    return toVisit(res.data);
  });

/* ---------------- Appointments ---------------- */

export const listAppointments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).parse(d))
  .handler(async ({ data, context }): Promise<Appointment[]> => {
    await requireLevel(context, "appointments", "view");
    const db = await admin();
    const { data: rows, error } = await db
      .from("appointments")
      .select(`*, ${PATIENT_REF}`)
      .gte("starts_at", data.from)
      .lt("starts_at", data.to)
      .order("starts_at")
      .limit(1000);
    if (error) throw new Error("تعذر تحميل المواعيد.");
    return rows.map((r) => toAppointment(r as never));
  });

export const saveAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        patientId: z.string().uuid(),
        doctorId: z.string().max(64).nullable(),
        department: z.string().max(60),
        startsAt: z.string().datetime({ offset: true }),
        durationMin: z.number().int().min(5).max(600),
        reason: text(300),
        notes: text(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireLevel(context, "appointments", data.id ? "edit" : "add");
    const db = await admin();
    // A doctor can't hold two active bookings that overlap.
    if (data.doctorId) {
      const start = new Date(data.startsAt).getTime();
      const end = start + data.durationMin * 60000;
      const { data: same } = await db
        .from("appointments")
        .select("id, starts_at, duration_min")
        .eq("doctor_id", data.doctorId)
        .in("status", ["booked", "arrived"])
        .gte("starts_at", new Date(start - 12 * 3600000).toISOString())
        .lt("starts_at", new Date(end).toISOString());
      const clash = (same ?? []).find(
        (a) => a.id !== data.id && new Date(a.starts_at).getTime() + a.duration_min * 60000 > start,
      );
      if (clash) throw new Error("الطبيب عنده موعد آخر في نفس الوقت.");
    }
    const row = {
      patient_id: data.patientId,
      doctor_id: data.doctorId,
      department: data.department,
      starts_at: data.startsAt,
      duration_min: data.durationMin,
      reason: data.reason,
      notes: data.notes,
    };
    const res = data.id
      ? await db.from("appointments").update(row).eq("id", data.id).select("id").single()
      : await db.from("appointments").insert({ ...row, created_by: context.userId }).select("id").single();
    if (res.error) throw new Error("تعذر حفظ الموعد.");
    return { id: res.data.id };
  });

export const setAppointmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["booked", "arrived", "done", "cancelled", "no_show"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireLevel(context, "appointments", "add");
    const db = await admin();
    const { error } = await db.from("appointments").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error("تعذر تحديث حالة الموعد.");
    return { ok: true };
  });

/* ---------------- Lab ---------------- */

const LabTestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  result: z.string().max(60).default(""),
  unit: z.string().max(20).default(""),
  range: z.string().max(40).default(""),
});

export const listLabOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        status: z.enum(["all", "ordered", "in_progress", "done", "cancelled"]).default("all"),
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LabOrder[]> => {
    await requireLevel(context, "lab", "view");
    const db = await admin();
    let q = db.from("lab_orders").select(`*, ${PATIENT_REF}`).gte("ordered_at", data.from).lt("ordered_at", data.to);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q.order("ordered_at", { ascending: false }).limit(500);
    if (error) throw new Error("تعذر تحميل طلبات المعمل.");
    return rows.map((r) => toLab(r as never));
  });

export const saveLabOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        patientId: z.string().uuid(),
        doctorId: z.string().max(64).nullable(),
        tests: z.array(LabTestSchema).min(1).max(60),
        notes: text(1000),
        status: z.enum(["ordered", "in_progress", "done", "cancelled"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireLevel(context, "lab", data.id ? "edit" : "add");
    const db = await admin();
    const status = data.status === "cancelled" ? "cancelled" : labComplete(data.tests) ? "done" : data.tests.some((t) => t.result.trim()) ? "in_progress" : (data.status ?? "ordered");
    const row = {
      patient_id: data.patientId,
      doctor_id: data.doctorId,
      tests: data.tests,
      notes: data.notes,
      status,
      result_at: status === "done" ? new Date().toISOString() : null,
    };
    const res = data.id
      ? await db.from("lab_orders").update(row).eq("id", data.id).select("id, order_no").single()
      : await db.from("lab_orders").insert({ ...row, created_by: context.userId }).select("id, order_no").single();
    if (res.error) throw new Error("تعذر حفظ طلب التحليل.");
    return { id: res.data.id, orderNo: res.data.order_no, status };
  });

/** Counts for the data-size monitor (director only). */
export const medicalCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireLevel(context, "system", "view");
    const db = await admin();
    const count = async (t: "patients" | "appointments" | "medical_visits" | "lab_orders" | "stored_files") =>
      (await db.from(t).select("id", { count: "exact", head: true })).count ?? 0;
    const [patients, appointments, visits, labOrders, files] = await Promise.all([
      count("patients"),
      count("appointments"),
      count("medical_visits"),
      count("lab_orders"),
      count("stored_files"),
    ]);
    return { patients, appointments, visits, labOrders, files };
  });

/* ---------------- Receipt desk: pick or open a patient file (name, phone, file number only) ---------------- */

export interface PatientRefLite {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
  nationalId: string | null;
}

export const findPatientsForBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().max(80) }).parse(d))
  .handler(async ({ data, context }): Promise<PatientRefLite[]> => {
    await requireLevel(context, "billing", "add");
    const q = data.q.trim().replace(/[%,()*]/g, " ");
    if (q.length < 2) return [];
    const db = await admin();
    const { data: rows } = await db
      .from("patients")
      .select("id, mrn, full_name, phone, national_id")
      .or(`full_name.ilike.%${q}%,mrn.ilike.%${q}%,phone.ilike.%${q}%,national_id.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(8);
    return (rows ?? []).map((r) => ({ id: r.id, mrn: r.mrn, fullName: r.full_name, phone: r.phone, nationalId: r.national_id }));
  });

/** Opens a file for a new patient straight from the receipt (so every receipt has a file). */
export const openPatientFromBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ fullName: z.string().trim().min(2).max(120), phone: text(30) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PatientRefLite> => {
    await requireLevel(context, "billing", "add");
    const db = await admin();
    const { data: row, error } = await db
      .from("patients")
      .insert({ full_name: data.fullName, phone: data.phone, created_by: context.userId })
      .select("id, mrn, full_name, phone, national_id")
      .single();
    if (error) throw new Error("تعذر فتح ملف للمريض.");
    return { id: row.id, mrn: row.mrn, fullName: row.full_name, phone: row.phone, nationalId: row.national_id };
  });
