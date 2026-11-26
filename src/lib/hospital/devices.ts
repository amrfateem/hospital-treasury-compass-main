/**
 * Medical devices register (سجل الأجهزة الطبية): every device of every department with its
 * preventive maintenance, repairs and calibration history. Due dates are derived from the
 * history (never stored twice), so the register always shows what is overdue. Pure.
 */

export type DeviceStatus = "working" | "maintenance" | "out" | "retired";
export const DEVICE_STATUS: Record<DeviceStatus, string> = {
  working: "يعمل",
  maintenance: "تحت الصيانة",
  out: "عطلان / متوقف",
  retired: "مُكهَّن (خارج الخدمة)",
};

export type DeviceRisk = "high" | "medium" | "low";
export const DEVICE_RISK: Record<DeviceRisk, string> = {
  high: "عالي الخطورة (دعم حياة)",
  medium: "متوسط الخطورة",
  low: "منخفض الخطورة",
};

export interface MedicalDevice {
  id: string;
  /** Internal asset / device code (e.g. ICU-VEN-01). */
  code: string;
  name: string;
  department: string;
  /** Device family, used to suggest the department's calibration guide (e.g. "جهاز تنفس صناعي"). */
  deviceType?: string | undefined;
  brand?: string | undefined;
  model?: string | undefined;
  serial?: string | undefined;
  location?: string | undefined;
  supplier?: string | undefined;
  /** Company holding the maintenance contract. */
  serviceCompany?: string | undefined;
  servicePhone?: string | undefined;
  purchaseDate?: string | undefined;
  installDate?: string | undefined;
  warrantyEnd?: string | undefined;
  /** Contract with the maintenance company ends on. */
  contractEnd?: string | undefined;
  cost?: number | undefined;
  status: DeviceStatus;
  risk: DeviceRisk;
  /** Preventive maintenance every N months (0 = not required). */
  maintenanceEveryMonths: number;
  /** Calibration every N months (0 = not required). */
  calibrationEveryMonths: number;
  notes?: string | undefined;
  createdAt: number;
  by?: string | undefined;
}

export type DeviceLogKind = "preventive" | "corrective" | "calibration" | "inspection" | "safety";
export const DEVICE_LOG_KINDS: Record<DeviceLogKind, string> = {
  preventive: "صيانة وقائية دورية",
  corrective: "صيانة إصلاحية (عطل)",
  calibration: "معايرة",
  inspection: "فحص / تفتيش دوري",
  safety: "اختبار سلامة كهربائية",
};

export type CalibrationResult = "pass" | "adjusted" | "fail";
export const CALIBRATION_RESULTS: Record<CalibrationResult, string> = {
  pass: "مطابق",
  adjusted: "مطابق بعد الضبط",
  fail: "غير مطابق",
};

export interface DeviceLog {
  id: string;
  deviceId: string;
  kind: DeviceLogKind;
  date: string;
  /** Engineer / technician who did the work. */
  performedBy: string;
  company?: string | undefined;
  description: string;
  cost: number;
  result?: CalibrationResult | undefined;
  certificateNo?: string | undefined;
  /** Explicit next due date (otherwise derived from the device interval). */
  nextDue?: string | undefined;
  downtimeHours?: number | undefined;
  parts?: string | undefined;
  /** Device status after the work. */
  statusAfter?: DeviceStatus | undefined;
  createdAt: number;
  recordedBy?: string | undefined;
}

/** A department's own calibration guide (written by the hospital or an uploaded file). */
export interface CalibrationGuide {
  id: string;
  department: string;
  deviceType: string;
  title: string;
  interval: string;
  standard?: string | undefined;
  tools: string[];
  steps: string[];
  acceptance: string[];
  notes?: string | undefined;
  /** Uploaded guidance file (stored_files id) and its name. */
  fileId?: string | undefined;
  fileName?: string | undefined;
  createdAt: number;
  by?: string | undefined;
}

export type DueState = "none" | "never" | "ok" | "soon" | "overdue";
export const DUE_LABELS: Record<DueState, string> = {
  none: "غير مطلوب",
  never: "لم تُسجَّل بعد",
  ok: "في موعدها",
  soon: "مستحقة خلال 30 يوم",
  overdue: "متأخرة",
};

/** Adds whole months to an ISO date (day clamped to the month's end). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export interface DueInfo {
  state: DueState;
  last?: string | undefined;
  next?: string | undefined;
  /** Days until the due date (negative = overdue). */
  days?: number | undefined;
}

function dueOf(
  device: MedicalDevice,
  logs: DeviceLog[],
  kinds: DeviceLogKind[],
  every: number,
  today: string,
): DueInfo {
  if (device.status === "retired" || !(every > 0)) return { state: "none" };
  const mine = logs
    .filter((l) => l.deviceId === device.id && kinds.includes(l.kind))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const last = mine[0];
  const start = last?.date ?? device.installDate ?? device.purchaseDate;
  if (!start) return { state: "never" };
  const next = last?.nextDue || addMonths(start, every);
  const days = daysBetween(today, next);
  const state: DueState = !last && !device.installDate && !device.purchaseDate ? "never" : days < 0 ? "overdue" : days <= 30 ? "soon" : "ok";
  return { state: !last && days < 0 ? "overdue" : state, last: last?.date, next, days };
}

/** Next preventive maintenance and calibration of a device. */
export function deviceSchedule(device: MedicalDevice, logs: DeviceLog[], today: string) {
  const maintenance = dueOf(device, logs, ["preventive"], device.maintenanceEveryMonths, today);
  const calibration = dueOf(device, logs, ["calibration"], device.calibrationEveryMonths, today);
  const warranty: DueState = !device.warrantyEnd
    ? "none"
    : device.warrantyEnd < today
      ? "overdue"
      : daysBetween(today, device.warrantyEnd) <= 30
        ? "soon"
        : "ok";
  const lastCalibration = logs
    .filter((l) => l.deviceId === device.id && l.kind === "calibration")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return { maintenance, calibration, warranty, lastResult: lastCalibration?.result };
}

/** Counts for the register's summary cards. */
export function devicesSummary(devices: MedicalDevice[], logs: DeviceLog[], today: string) {
  let maintenanceDue = 0;
  let calibrationDue = 0;
  let soon = 0;
  for (const d of devices) {
    const s = deviceSchedule(d, logs, today);
    if (s.maintenance.state === "overdue" || s.maintenance.state === "never") maintenanceDue++;
    if (s.calibration.state === "overdue" || s.calibration.state === "never") calibrationDue++;
    if (s.maintenance.state === "soon" || s.calibration.state === "soon") soon++;
  }
  return {
    total: devices.filter((d) => d.status !== "retired").length,
    working: devices.filter((d) => d.status === "working").length,
    down: devices.filter((d) => d.status === "out" || d.status === "maintenance").length,
    maintenanceDue,
    calibrationDue,
    soon,
  };
}

/** Maintenance / calibration spending between two dates (inclusive), by device. */
export function maintenanceCost(logs: DeviceLog[], from: string, to: string) {
  const inRange = logs.filter((l) => l.date >= from && l.date <= to);
  const byDevice = new Map<string, number>();
  for (const l of inRange) byDevice.set(l.deviceId, Math.round(((byDevice.get(l.deviceId) ?? 0) + (l.cost || 0)) * 100) / 100);
  return {
    total: Math.round(inRange.reduce((s, l) => s + (l.cost || 0), 0) * 100) / 100,
    count: inRange.length,
    byDevice,
  };
}
