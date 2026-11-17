import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/hospital/auth-middleware";
import { can } from "@/lib/hospital/permissions";
import { patientMoney, type PatientMoney } from "@/lib/hospital/patient-money";

/**
 * Paid / remaining per patient, computed on the server from the full records (desk staff see
 * only their own drawer, so their device cannot add up collections made at other desks).
 */
export const getPatientMoney = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<Record<string, PatientMoney>> => {
    const me = context.me;
    if (!can(me, "patients", "view") && !can(me, "billing", "view"))
      throw new Error("ليست لديك صلاحية لهذه العملية.");
    if (!data.ids.length) return {};
    const { readState } = await import("@/lib/hospital/state.server");
    const { db } = await readState();
    return patientMoney(db, data.ids);
  });

export interface Debtor extends PatientMoney {
  patientId: string;
  name: string;
  phone: string | null;
  mrn: string | null;
}

/** Every patient who still owes part of a receipt, largest first. */
export const getPatientDebtors = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<Debtor[]> => {
    const me = context.me;
    if (!can(me, "patients", "view") && !can(me, "billing", "view"))
      throw new Error("ليست لديك صلاحية لهذه العملية.");
    const { readState } = await import("@/lib/hospital/state.server");
    const { db } = await readState();
    const accounts = db.creditAccounts.filter((a) => a.id.startsWith("pt-") && a.patientId);
    const money = patientMoney(db, accounts.map((a) => a.patientId!));
    const mrn = new Map<string, string>();
    for (const inv of db.patientInvoices) if (inv.patientId && inv.patientMrn) mrn.set(inv.patientId, inv.patientMrn);
    return accounts
      .map((a) => ({
        ...money[a.patientId!]!,
        patientId: a.patientId!,
        name: a.name,
        phone: a.phone ?? null,
        mrn: mrn.get(a.patientId!) ?? null,
      }))
      .filter((d) => d.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining);
  });
