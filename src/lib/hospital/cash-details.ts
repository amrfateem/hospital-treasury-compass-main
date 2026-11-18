/**
 * Source-level rows for the cash details workspace. The general ledger stays the accounting
 * truth; these helpers only group the original documents (receipts, cash movements, petty
 * requests) for the manager's detail screen, so one pound is never counted twice.
 */
import { invoiceAmounts } from "./finance";
import type { HospitalDB, PatientInvoice, PettyRequest, Transaction } from "./model";

export type DetailsTab = "revenue" | "expenses" | "petty";

export interface RevenueDetail {
  invoice: PatientInvoice;
  amounts: ReturnType<typeof invoiceAmounts>;
}

export interface PettyDetail {
  request: PettyRequest;
  spend?: Transaction | undefined;
}

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
const byNewest = (a: { date: string; createdAt?: number }, b: { date: string; createdAt?: number }) =>
  b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0);

export function revenueDetails(db: HospitalDB, from: string, to: string): RevenueDetail[] {
  return db.patientInvoices
    .filter((i) => inRange(i.date, from, to))
    .map((invoice) => ({ invoice, amounts: invoiceAmounts(invoice) }))
    .sort((a, b) => byNewest(a.invoice, b.invoice));
}

/** Every posted cash outflow except petty cash, which has its own block. */
export function expenseDetails(db: HospitalDB, from: string, to: string): Transaction[] {
  return db.transactions
    .filter((t) => t.kind === "out" && t.source !== "petty" && inRange(t.date, from, to))
    .sort(byNewest);
}

/**
 * Requests for the period plus paid petty spends that were entered directly (no request).
 * A paid request appears once, as its spend.
 */
export function pettyDetails(db: HospitalDB, from: string, to: string): PettyDetail[] {
  const spends = db.transactions.filter(
    (t) => t.kind === "out" && t.source === "petty" && inRange(t.date, from, to),
  );
  const spendByRequest = new Map(spends.filter((t) => !!t.ref).map((t) => [t.ref!, t]));
  const used = new Set<string>();

  const fromRequests = db.pettyRequests
    .filter((r) => inRange(r.date, from, to))
    .map((request) => {
      const spend = spendByRequest.get(request.id);
      if (spend) used.add(spend.id);
      return { request, spend };
    });

  const direct = spends
    .filter((t) => !used.has(t.id))
    .map((spend) => ({
      request: {
        id: spend.ref ?? spend.id,
        number: spend.receiptId,
        date: spend.date,
        department: spend.department,
        category: spend.category ?? "",
        description: spend.description,
        amount: spend.amount,
        status: "paid" as const,
        requestedBy: spend.by ?? "",
        requestedById: "",
        createdAt: spend.createdAt,
        paidBy: spend.by,
        paidOn: spend.date,
        boxId: spend.boxId,
      },
      spend,
    }));

  return [...fromRequests, ...direct].sort((a, b) => byNewest(a.request, b.request));
}

export function totalsOf(rows: { amount: number }[]) {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}
