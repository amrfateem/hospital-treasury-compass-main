/**
 * Medical records live in their own SQLite tables (not the finance JSON document) so they
 * scale and can be searched. Every function checks the caller's section first.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { all, get, nextCounter, run, transaction } from "@/lib/local/db.server";
import { requireAuth } from "@/lib/hospital/auth-middleware";
import { requireLevel } from "@/lib/hospital/access";
import { labComplete, type Appointment, type LabOrder, type Patient, type Visit } from "./model";

const text = (max = 500) => z.string().max(max).nullable().transform((v) => (v && v.trim() ? v.trim() : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface PatientRow {
  id: string;
  mrn: string;
  full_name: string;
  national_id: string | null;
  birth_date: string | null;
  gender: "male" | "female" | null;
  phone: string | null;
  address: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  emergency_contact: string | null;
  notes: string | null;
  created_at: string;
}

interface AppointmentRow {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  department: string;
  starts_at: string;
  duration_min: number;
  status: string;
  reason: string | null;
  notes: string | null;
  p_full_name: string | null;
  p_mrn: string | null;
  p_phone: string | null;
}

interface LabRow {
  id: string;
  order_no: string;
  patient_id: string;
  doctor_id: string | null;
  ordered_at: string;
  status: string;
  tests: string;
  notes: string | null;
  result_at: string | null;
  p_full_name: string | null;
  p_mrn: string | null;
  p_phone: string | null;
}

const toPatient = (r: PatientRow): Patient => ({
  id: r.id,
  mrn: r.mrn,
  fullName: r.full_name,
  nationalId: r.national_id,
  birthDate: r.birth_date,
  gender: r.gender ?? null,
  phone: r.phone,
  address: r.address,
  bloodType: r.blood_type,
  allergies: r.allergies,
  chronicConditions: r.chronic_conditions,
  emergencyContact: r.emergency_contact,
  notes: r.notes,
  createdAt: r.created_at,
});

const toAppointment = (r: AppointmentRow): Appointment => ({
  id: r.id,
  patientId: r.patient_id,
  patientName: r.p_full_name ?? "",
  patientMrn: r.p_mrn ?? "",
  patientPhone: r.p_phone ?? null,
  doctorId: r.doctor_id,
  department: r.department,
  startsAt: r.starts_at,
  durationMin: r.duration_min,
  status: r.status as Appointment["status"],
  reason: r.reason,
  notes: r.notes,
});

const toLab = (r: LabRow): LabOrder => ({
  id: r.id,
  orderNo: r.order_no,
  patientId: r.patient_id,
  patientName: r.p_full_name ?? "",
  patientMrn: r.p_mrn ?? "",
  doctorId: r.doctor_id,
  orderedAt: r.ordered_at,
  status: r.status as LabOrder["status"],
  tests: (JSON.parse(r.tests || "[]") as LabOrder["tests"]) ?? [],
  notes: r.notes,
  resultAt: r.result_at,
});

interface VisitRow {
  id: string;
  patient_id: string;
  visit_date: string;
  department: string;
  doctor_id: string | null;
  complaint: string | null;
  diagnosis: string | null;
  prescription: string | null;
  notes: string | null;
  vitals: string;
}

const toVisit = (r: VisitRow): Visit => ({
  id: r.id,
  patientId: r.patient_id,
  visitDate: r.visit_date,
  department: r.department,
  doctorId: r.doctor_id,
  complaint: r.complaint,
  diagnosis: r.diagnosis,
  prescription: r.prescription,
  notes: r.notes,
  vitals: (JSON.parse(r.vitals || "{}") as Visit["vitals"]) ?? {},
});

const like = (q: string) => `%${q.replace(/[%_\\]/g, " ")}%`;

/* ---------------- Patients ---------------- */

export const searchPatients = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ q: z.string().max(80).default(""), limit: z.number().int().min(1).max(100).default(30) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<Patient[]> => {
    await requireLevel(context, "patients", "view");
    const q = like(data.q.trim());
    return all<PatientRow>(
      `SELECT * FROM patients
        WHERE full_name LIKE ? OR mrn LIKE ? OR phone LIKE ? OR national_id LIKE ?
        ORDER BY created_at DESC LIMIT ?`,
      q,
      q,
      q,
      q,
      data.limit,
    ).map(toPatient);
  });

/** Patient picker for appointments and lab: needs any of the three medical sections. */
export const findPatientsForBooking = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().max(80), section: z.enum(["appointments", "lab"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireLevel(context, data.section, "add");
    const q = like(data.q.trim());
    if (!data.q.trim()) return [];
    return all<{ id: string; mrn: string; full_name: string; phone: string | null }>(
      `SELECT id, mrn, full_name, phone FROM patients
        WHERE full_name LIKE ? OR mrn LIKE ? OR phone LIKE ? LIMIT 15`,
      q,
      q,
      q,
    ).map((r) => ({ id: r.id, mrn: r.mrn, fullName: r.full_name, phone: r.phone }));
  });

export const getPatientFile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireLevel(context, "patients", "view");
    const patient = get<PatientRow>("SELECT * FROM patients WHERE id = ?", data.id);
    if (!patient) throw new Error("الملف غير موجود.");
    const visits = all<VisitRow>(
      "SELECT * FROM medical_visits WHERE patient_id = ? ORDER BY visit_date DESC LIMIT 200",
      data.id,
    );
    const appointments = all<AppointmentRow>(
      `SELECT a.*, p.full_name AS p_full_name, p.mrn AS p_mrn, p.phone AS p_phone
         FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id
        WHERE a.patient_id = ? ORDER BY a.starts_at DESC LIMIT 100`,
      data.id,
    );
    const labOrders = all<LabRow>(
      `SELECT l.*, p.full_name AS p_full_name, p.mrn AS p_mrn, p.phone AS p_phone
         FROM lab_orders l LEFT JOIN patients p ON p.id = l.patient_id
        WHERE l.patient_id = ? ORDER BY l.ordered_at DESC LIMIT 100`,
      data.id,
    );
    return {
      patient: toPatient(patient),
      visits: visits.map(toVisit),
      appointments: appointments.map(toAppointment),
      labOrders: labOrders.map(toLab),
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
  .middleware([requireAuth])
  .inputValidator((d: unknown) => PatientSchema.parse(d))
  .handler(async ({ data, context }): Promise<Patient> => {
    await requireLevel(context, "patients", data.id ? "edit" : "add");
    if (data.nationalId) {
      const dup = get<{ mrn: string }>(
        "SELECT mrn FROM patients WHERE national_id = ? AND id <> ?",
        data.nationalId,
        data.id ?? "",
      );
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
    const now = new Date().toISOString();
    const id = data.id
      ? (transaction(() => {
          run(
            `UPDATE patients SET full_name = ?, national_id = ?, birth_date = ?, gender = ?, phone = ?,
               address = ?, blood_type = ?, allergies = ?, chronic_conditions = ?, emergency_contact = ?,
               notes = ?, updated_at = ? WHERE id = ?`,
            row.full_name,
            row.national_id,
            row.birth_date,
            row.gender,
            row.phone,
            row.address,
            row.blood_type,
            row.allergies,
            row.chronic_conditions,
            row.emergency_contact,
            row.notes,
            now,
            data.id,
          );
          return data.id;
        }))
      : transaction(() => {
          const newId = crypto.randomUUID();
          const n = nextCounter("patient_mrn");
          const mrn = `MRN-${String(n).padStart(6, "0")}`;
          run(
            `INSERT INTO patients (id, mrn, full_name, national_id, birth_date, gender, phone, address,
               blood_type, allergies, chronic_conditions, emergency_contact, notes, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId,
            mrn,
            row.full_name,
            row.national_id,
            row.birth_date,
            row.gender,
            row.phone,
            row.address,
            row.blood_type,
            row.allergies,
            row.chronic_conditions,
            row.emergency_contact,
            row.notes,
            context.userId,
            now,
            now,
          );
          return newId;
        });
    const saved = get<PatientRow>("SELECT * FROM patients WHERE id = ?", id);
    if (!saved) throw new Error("تعذر حفظ ملف المريض.");
    return toPatient(saved);
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
  .middleware([requireAuth])
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
    const row = {
      patient_id: data.patientId,
      visit_date: data.visitDate,
      department: data.department,
      doctor_id: data.doctorId,
      complaint: data.complaint,
      diagnosis: data.diagnosis,
      prescription: data.prescription,
      notes: data.notes,
      vitals: JSON.stringify(data.vitals ?? {}),
    };
    const now = new Date().toISOString();
    const id = data.id
      ? (transaction(() => {
          run(
            `UPDATE medical_visits SET patient_id = ?, visit_date = ?, department = ?, doctor_id = ?,
               complaint = ?, diagnosis = ?, prescription = ?, notes = ?, vitals = ? WHERE id = ?`,
            row.patient_id,
            row.visit_date,
            row.department,
            row.doctor_id,
            row.complaint,
            row.diagnosis,
            row.prescription,
            row.notes,
            row.vitals,
            data.id,
          );
          return data.id;
        }))
      : transaction(() => {
          const newId = crypto.randomUUID();
          run(
            `INSERT INTO medical_visits (id, patient_id, visit_date, department, doctor_id, complaint,
               diagnosis, prescription, notes, vitals, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId,
            row.patient_id,
            row.visit_date,
            row.department,
            row.doctor_id,
            row.complaint,
            row.diagnosis,
            row.prescription,
            row.notes,
            row.vitals,
            context.userId,
            now,
          );
          return newId;
        });
    const saved = get<VisitRow>("SELECT * FROM medical_visits WHERE id = ?", id);
    if (!saved) throw new Error("تعذر حفظ الزيارة.");
    return toVisit(saved);
  });

/* ---------------- Appointments ---------------- */

export const listAppointments = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<Appointment[]> => {
    await requireLevel(context, "appointments", "view");
    return all<AppointmentRow>(
      `SELECT a.*, p.full_name AS p_full_name, p.mrn AS p_mrn, p.phone AS p_phone
         FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id
        WHERE a.starts_at >= ? AND a.starts_at < ? ORDER BY a.starts_at LIMIT 1000`,
      data.from,
      data.to,
    ).map(toAppointment);
  });

export const saveAppointment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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
    if (data.doctorId) {
      const start = new Date(data.startsAt).getTime();
      const end = start + data.durationMin * 60000;
      const same = all<{ id: string; starts_at: string; duration_min: number }>(
        `SELECT id, starts_at, duration_min FROM appointments
          WHERE doctor_id = ? AND status IN ('booked','arrived')
            AND starts_at >= ? AND starts_at < ?`,
        data.doctorId,
        new Date(start - 12 * 3600000).toISOString(),
        new Date(end).toISOString(),
      );
      const clash = same.find(
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
    const id = data.id
      ? (transaction(() => {
          run(
            `UPDATE appointments SET patient_id = ?, doctor_id = ?, department = ?, starts_at = ?,
               duration_min = ?, reason = ?, notes = ? WHERE id = ?`,
            row.patient_id,
            row.doctor_id,
            row.department,
            row.starts_at,
            row.duration_min,
            row.reason,
            row.notes,
            data.id,
          );
          return data.id;
        }))
      : transaction(() => {
          const newId = crypto.randomUUID();
          run(
            `INSERT INTO appointments (id, patient_id, doctor_id, department, starts_at, duration_min,
               reason, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId,
            row.patient_id,
            row.doctor_id,
            row.department,
            row.starts_at,
            row.duration_min,
            row.reason,
            row.notes,
            context.userId,
            new Date().toISOString(),
          );
          return newId;
        });
    return { id };
  });

export const setAppointmentStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["booked", "arrived", "done", "cancelled", "no_show"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireLevel(context, "appointments", "add");
    run("UPDATE appointments SET status = ? WHERE id = ?", data.status, data.id);
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
  .middleware([requireAuth])
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
    const filter = data.status === "all" ? "" : " AND l.status = ?";
    const params = data.status === "all" ? [data.from, data.to] : [data.from, data.to, data.status];
    return all<LabRow>(
      `SELECT l.*, p.full_name AS p_full_name, p.mrn AS p_mrn, p.phone AS p_phone
         FROM lab_orders l LEFT JOIN patients p ON p.id = l.patient_id
        WHERE l.ordered_at >= ? AND l.ordered_at < ?${filter}
        ORDER BY l.ordered_at DESC LIMIT 500`,
      ...params,
    ).map(toLab);
  });

export const saveLabOrder = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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
    const status =
      data.status === "cancelled"
        ? "cancelled"
        : labComplete(data.tests)
          ? "done"
          : data.tests.some((t) => t.result.trim())
            ? "in_progress"
            : (data.status ?? "ordered");
    const row = {
      patient_id: data.patientId,
      doctor_id: data.doctorId,
      tests: JSON.stringify(data.tests),
      notes: data.notes,
      status,
      result_at: status === "done" ? new Date().toISOString() : null,
    };
    const id = data.id
      ? (transaction(() => {
          run(
            `UPDATE lab_orders SET patient_id = ?, doctor_id = ?, tests = ?, notes = ?, status = ?,
               result_at = ? WHERE id = ?`,
            row.patient_id,
            row.doctor_id,
            row.tests,
            row.notes,
            row.status,
            row.result_at,
            data.id,
          );
          return data.id;
        }))
      : transaction(() => {
          const newId = crypto.randomUUID();
          const n = nextCounter("lab_order");
          const orderNo = `LAB-${String(n).padStart(6, "0")}`;
          run(
            `INSERT INTO lab_orders (id, order_no, patient_id, doctor_id, ordered_at, status, tests, notes,
               result_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId,
            orderNo,
            row.patient_id,
            row.doctor_id,
            new Date().toISOString(),
            row.status,
            row.tests,
            row.notes,
            row.result_at,
            context.userId,
            new Date().toISOString(),
          );
          return newId;
        });
    const saved = get<{ id: string; order_no: string }>("SELECT id, order_no FROM lab_orders WHERE id = ?", id);
    if (!saved) throw new Error("تعذر حفظ طلب التحليل.");
    return { id: saved.id, orderNo: saved.order_no, status };
  });

/** Counts for the data-size monitor (director only). */
export const medicalCounts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireLevel(context, "system", "view");
    const count = (table: string) =>
      Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
    return {
      patients: count("patients"),
      appointments: count("appointments"),
      visits: count("medical_visits"),
      labOrders: count("lab_orders"),
      files: count("stored_files"),
    };
  });

/* ---------------- Receipt desk: pick or open a patient file ---------------- */

export interface PatientRefLite {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
  nationalId: string | null;
}

export const findPatientsForBilling = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().max(80) }).parse(d))
  .handler(async ({ data, context }): Promise<PatientRefLite[]> => {
    await requireLevel(context, "billing", "add");
    if (data.q.trim().length < 2) return [];
    const q = like(data.q.trim());
    return all<{ id: string; mrn: string; full_name: string; phone: string | null; national_id: string | null }>(
      `SELECT id, mrn, full_name, phone, national_id FROM patients
        WHERE full_name LIKE ? OR mrn LIKE ? OR phone LIKE ? OR national_id LIKE ?
        ORDER BY created_at DESC LIMIT 8`,
      q,
      q,
      q,
      q,
    ).map((r) => ({ id: r.id, mrn: r.mrn, fullName: r.full_name, phone: r.phone, nationalId: r.national_id }));
  });

/** Opens a file for a new patient straight from the receipt (so every receipt has a file). */
export const openPatientFromBilling = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ fullName: z.string().trim().min(2).max(120), phone: text(30) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PatientRefLite> => {
    await requireLevel(context, "billing", "add");
    const now = new Date().toISOString();
    const saved = transaction(() => {
      const id = crypto.randomUUID();
      const n = nextCounter("patient_mrn");
      const mrn = `MRN-${String(n).padStart(6, "0")}`;
      run(
        `INSERT INTO patients (id, mrn, full_name, phone, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        mrn,
        data.fullName,
        data.phone,
        context.userId,
        now,
        now,
      );
      return { id, mrn };
    });
    return { id: saved.id, mrn: saved.mrn, fullName: data.fullName, phone: data.phone, nationalId: null };
  });
