/**
 * Branches (الفروع). Every drawer / bank account belongs to a branch (default: main); money
 * records follow their box, so a branch view keeps only records whose box is in that branch.
 */
import { MAIN_BOX_ID, MAIN_BRANCH_ID, type HospitalDB } from "./model";

export const branchOfBox = (db: Pick<HospitalDB, "cashboxes">, boxId: string | undefined) =>
  db.cashboxes.find((b) => b.id === (boxId || MAIN_BOX_ID))?.branchId || MAIN_BRANCH_ID;

/** The records of one branch ("all" = the whole hospital). */
export function dbForBranch(db: HospitalDB, branchId: string): HospitalDB {
  if (!branchId || branchId === "all") return db;
  const boxes = new Set(db.cashboxes.filter((b) => (b.branchId || MAIN_BRANCH_ID) === branchId).map((b) => b.id));
  const inBranch = (boxId: string | undefined) => boxes.has(boxId || MAIN_BOX_ID);
  return {
    ...db,
    transactions: db.transactions.filter((t) => inBranch(t.boxId)),
    patientInvoices: db.patientInvoices.filter((i) => inBranch(i.boxId)),
    supplierInvoices: db.supplierInvoices.filter((s) => inBranch(s.boxId)),
    transfers: db.transfers.filter((t) => inBranch(t.from) || inBranch(t.to)),
    eInvoices: branchId === MAIN_BRANCH_ID ? db.eInvoices : [],
    // Hospital-wide items (assets, manual entries, credit charges) stay with the main branch.
    assets: branchId === MAIN_BRANCH_ID ? db.assets : [],
    journalEntries: branchId === MAIN_BRANCH_ID ? db.journalEntries : [],
    creditCharges: branchId === MAIN_BRANCH_ID ? db.creditCharges : [],
  };
}

/** Converts a foreign-currency amount at `rate` EGP per unit. */
export const toEgp = (amount: number, rate: number) => Math.round(amount * rate * 100) / 100;
