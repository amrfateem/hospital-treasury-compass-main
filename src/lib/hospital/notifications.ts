/**
 * Every approval request of every type as one flat list of notices — feeds the notifications
 * menu (approver: what waits for me; requester: what was decided on my requests) and the
 * approvals tab, so a new request type is added in one place. Pure.
 */
import { findDepartment } from "./constants";
import type { HospitalDB, Role } from "./model";
import { canApprove, type PermActor } from "./permissions";

export type RequestKind = "payment" | "petty" | "purchase" | "issue" | "receipt" | "patientDelete" | "refund" | "advance" | "dayReopen";
export type NoticeStatus = "pending" | "approved" | "rejected";

export interface Notice {
  /** Unique across kinds: `${kind}:${id}`. */
  key: string;
  kind: RequestKind;
  id: string;
  number: string;
  title: string;
  detail: string;
  amount?: number | undefined;
  requestedBy: string;
  requestedById?: string | undefined;
  requestedRole?: Role | undefined;
  /** When the request was raised (ms). */
  at: number;
  status: NoticeStatus;
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  note?: string | undefined;
}

export const KIND_LABELS: Record<RequestKind, string> = {
  payment: "أمر صرف نقدي",
  petty: "طلب صرف نثريات",
  purchase: "طلبية شراء",
  issue: "طلب قسم من المخزن",
  receipt: "تعديل / حذف إيصال",
  patientDelete: "حذف ملف مريض",
  refund: "مرتجع لمريض",
  advance: "سلفة موظف",
  dayReopen: "إعادة فتح يوم مقفول بالخزينة",
};

export const KIND_LINKS = {
  payment: "/orders",
  petty: "/petty-cash",
  purchase: "/orders",
  issue: "/orders",
  receipt: "/billing",
  patientDelete: "/patients",
  refund: "/refunds",
  advance: "/advances",
  dayReopen: "/daily-closing",
} as const satisfies Record<RequestKind, string>;

const decided = (s: string): NoticeStatus => (s === "pending" ? "pending" : s === "rejected" ? "rejected" : "approved");

/** All requests (pending and decided), newest first. Cancelled purchase orders are left out. */
export function allNotices(db: HospitalDB): Notice[] {
  const item = (id: string) => db.stockItems.find((i) => i.id === id)?.name ?? "صنف";
  const dept = (id: string) => findDepartment(db.departments, id).name;
  const out: Notice[] = [];
  for (const o of db.paymentOrders)
    out.push({
      key: `payment:${o.id}`, kind: "payment", id: o.id, number: o.number,
      title: `${o.beneficiary} — ${o.description}`, detail: dept(o.department), amount: o.amount,
      requestedBy: o.requestedBy, requestedById: o.requestedById, requestedRole: o.requestedRole, at: o.createdAt,
      status: decided(o.status), decidedBy: o.decidedBy, decidedAt: o.decidedAt, note: o.decisionNote,
    });
  for (const r of db.pettyRequests)
    out.push({
      key: `petty:${r.id}`, kind: "petty", id: r.id, number: r.number,
      title: `${r.description}${r.paidTo ? ` — المستلم: ${r.paidTo}` : ""}`, detail: dept(r.department), amount: r.amount,
      requestedBy: r.requestedBy, requestedById: r.requestedById, requestedRole: r.requestedRole, at: r.createdAt,
      status: decided(r.status), decidedBy: r.decidedBy, decidedAt: r.decidedAt, note: r.decisionNote,
    });
  for (const o of db.purchaseOrders) {
    if (o.status === "cancelled") continue;
    out.push({
      key: `purchase:${o.id}`, kind: "purchase", id: o.id, number: o.number,
      title: `${o.supplierName} — ${o.lines.map((l) => `${l.description} (${l.qty})`).join("، ")}`, detail: dept(o.department),
      amount: Math.round(o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 100) / 100,
      requestedBy: o.requestedBy, requestedById: o.requestedById, requestedRole: o.requestedRole, at: o.createdAt,
      status: decided(o.status), decidedBy: o.decidedBy, decidedAt: o.decidedAt,
    });
  }
  for (const o of db.issueOrders) {
    if (!o.status) continue; // older saves before approvals existed
    out.push({
      key: `issue:${o.id}`, kind: "issue", id: o.id, number: o.number,
      title: `${dept(o.department)} — ${o.lines.map((l) => `${item(l.stockItemId)} (${l.qty})`).join("، ")}`, detail: `المستلم ${o.receiver}`,
      requestedBy: o.by, requestedById: o.requestedById, requestedRole: o.requestedRole, at: o.createdAt,
      status: decided(o.status), decidedBy: o.decidedBy, decidedAt: o.decidedAt, note: o.decisionNote,
    });
  }
  for (const r of db.editRequests) {
    const inv = db.patientInvoices.find((i) => i.id === r.invoiceId);
    out.push({
      key: `receipt:${r.id}`, kind: "receipt", id: r.id, number: inv?.number ?? "—",
      title: `${r.action === "delete" ? "حذف" : "تعديل"} إيصال ${inv?.patientName ?? ""}`.trim(), detail: `السبب: ${r.reason}`,
      requestedBy: r.requestedBy, requestedById: r.requestedById, requestedRole: r.requestedRole, at: r.requestedAt,
      status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt,
    });
  }
  for (const r of db.patientDeleteRequests)
    out.push({
      key: `patientDelete:${r.id}`, kind: "patientDelete", id: r.id, number: r.patientMrn,
      title: `حذف ملف المريض ${r.patientName}`, detail: `السبب: ${r.reason}`,
      requestedBy: r.requestedBy, requestedById: r.requestedById, requestedRole: r.requestedRole, at: r.requestedAt,
      status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt,
    });
  for (const r of db.refunds)
    out.push({
      key: `refund:${r.id}`, kind: "refund", id: r.id, number: r.number,
      title: `مرتجع للمريض ${r.patientName} — ${r.lines.map((l) => `${l.description} (${l.qty})`).join("، ")}`,
      detail: `إيصال ${r.invoiceNumber} — السبب: ${r.reason}`, amount: r.amount,
      requestedBy: r.requestedBy, requestedById: r.requestedById, requestedRole: r.requestedRole, at: r.createdAt,
      status: decided(r.status), decidedBy: r.decidedBy, decidedAt: r.decidedAt, note: r.decisionNote,
    });
  for (const a of db.advances)
    out.push({
      key: `advance:${a.id}`, kind: "advance", id: a.id, number: a.number,
      title: `سلفة للموظف ${a.employeeName} — على ${a.months} شهر`, detail: `السبب: ${a.reason}`, amount: a.amount,
      requestedBy: a.requestedBy, requestedById: a.requestedById, requestedRole: a.requestedRole, at: a.createdAt,
      status: decided(a.status), decidedBy: a.decidedBy, decidedAt: a.decidedAt, note: a.decisionNote,
    });
  for (const c of db.dailyClosings ?? []) {
    const r = c.reopen;
    if (!r) continue;
    out.push({
      key: `dayReopen:${c.id}`, kind: "dayReopen", id: c.id, number: c.date,
      title: `إعادة فتح الإقفال اليومي ليوم ${c.date}`, detail: `السبب: ${r.reason}`, amount: c.closing,
      requestedBy: r.requestedBy, requestedById: r.requestedById, requestedRole: r.requestedRole, at: r.requestedAt,
      status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt, note: r.note,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Requests waiting for this person's decision (empty for anyone who is not an approver). */
export function waitingForMe(db: HospitalDB, actor: PermActor & { id?: string }): Notice[] {
  return allNotices(db).filter((n) => n.status === "pending" && canApprove(actor, n));
}

/** This person's own requests: still waiting, and decided within `days` (newest decision first). */
export function myRequests(db: HospitalDB, actorId: string, now: number, days = 14) {
  const mine = allNotices(db).filter((n) => n.requestedById === actorId);
  const since = now - days * 86_400_000;
  return {
    waiting: mine.filter((n) => n.status === "pending"),
    decided: mine
      .filter((n) => n.status !== "pending" && (n.decidedAt ?? 0) >= since)
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)),
  };
}

/** Decisions on my requests made after I last opened the notifications. */
export const unseenDecisions = (decidedList: Notice[], seenAt: number) =>
  decidedList.filter((n) => (n.decidedAt ?? 0) > seenAt).length;
