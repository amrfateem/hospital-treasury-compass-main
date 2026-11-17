import { canApprove, type PermActor, type Role } from "./permissions";
import type { HospitalDB } from "./model";

type Requested = { requestedById?: string | undefined; requestedRole?: Role | undefined };

/** Every request still waiting for the finance manager's decision, across all request types. */
export function pendingRequests(db: HospitalDB): Requested[] {
  return [
    ...db.paymentOrders.filter((o) => o.status === "pending"),
    ...db.pettyRequests.filter((r) => r.status === "pending"),
    ...db.purchaseOrders.filter((o) => o.status === "pending"),
    ...db.issueOrders.filter((o) => o.status === "pending"),
    ...db.editRequests.filter((r) => r.status === "pending"),
    ...db.patientDeleteRequests.filter((r) => r.status === "pending"),
    ...db.refunds.filter((r) => r.status === "pending"),
    ...db.advances.filter((a) => a.status === "pending"),
    ...(db.dailyClosings ?? []).flatMap((c) => (c.reopen?.status === "pending" ? [c.reopen] : [])),
  ];
}

/** How many waiting requests this person may decide (0 for anyone who is not an approver). */
export function approvableCount(db: HospitalDB, actor: PermActor & { id?: string }) {
  return pendingRequests(db).filter((r) => canApprove(actor, r)).length;
}
