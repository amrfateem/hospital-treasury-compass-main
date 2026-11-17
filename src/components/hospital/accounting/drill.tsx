import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyRow, HeadRow, TableCard, Td, Th } from "@/components/hospital/kit";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, money } from "@/lib/hospital/format";
import {
  accountLedger,
  accountName,
  buildJournal,
  chartOfAccounts,
  ENTRY_SOURCE_LABELS,
  GROUPS,
  sourceRoute,
  type JournalEntry,
} from "@/lib/hospital/ledger";
import { dbForBranch } from "@/lib/hospital/branches";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

/** The whole journal up to `asOf`, recomputed when records change. */
export function useJournal(asOf: string, branch = "all") {
  const db = useHospitalDB();
  const entries = useMemo(
    () => buildJournal(dbForBranch(db, branch), asOf),
    [db.patientInvoices, db.supplierInvoices, db.transactions, db.transfers, db.assets, db.cashboxes, db.lists, db.eInvoices, db.journalEntries, db.creditCharges, db.creditAccounts, db.customAccounts, db.advances, asOf, branch], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const accounts = useMemo(() => chartOfAccounts(db), [db.cashboxes, db.lists, db.creditAccounts, db.customAccounts]); // eslint-disable-line react-hooks/exhaustive-deps
  return { entries, accounts, name: (code: string) => accountName(accounts, code) };
}

interface DrillTarget {
  account: string;
  from: string;
  to: string;
  costCenter?: string | undefined;
  title?: string | undefined;
}
const DrillCtx = createContext<{ open: (t: DrillTarget) => void; openEntry: (e: JournalEntry) => void } | null>(null);

/** Wraps a report so any amount can open its account ledger, then the entry behind it. */
export function DrillProvider({ entries, children }: { entries: JournalEntry[]; children: ReactNode }) {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  return (
    <DrillCtx.Provider value={{ open: setTarget, openEntry: setEntry }}>
      {children}
      <AccountSheet entries={entries} target={target} onClose={() => setTarget(null)} onEntry={setEntry} />
      <EntryDialog entry={entry} onClose={() => setEntry(null)} />
    </DrillCtx.Provider>
  );
}

export function useDrill() {
  const c = useContext(DrillCtx);
  if (!c) throw new Error("useDrill outside DrillProvider");
  return c;
}

/** A clickable amount that opens the ledger lines behind it. */
export function DrillAmount({
  value,
  target,
  className,
}: {
  value: number;
  target: DrillTarget;
  className?: string;
}) {
  const { open } = useDrill();
  return (
    <button
      type="button"
      onClick={() => open(target)}
      className={cn("drill-link num", value < 0 && "text-expense", className)}
      title="اضغط لعرض القيود"
    >
      {money(value)}
    </button>
  );
}

function AccountSheet({
  entries,
  target,
  onClose,
  onEntry,
}: {
  entries: JournalEntry[];
  target: DrillTarget | null;
  onClose: () => void;
  onEntry: (e: JournalEntry) => void;
}) {
  const db = useHospitalDB();
  const accounts = useMemo(() => chartOfAccounts(db), [db]);
  const r = useMemo(
    () => (target ? accountLedger(entries, target.account, target.from, target.to, target.costCenter) : null),
    [entries, target],
  );
  const title = target ? target.title ?? (GROUPS[target.account]?.name ?? accountName(accounts, target.account)) : "";
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-3xl" dir="rtl">
        <SheetHeader className="text-right">
          <SheetTitle className="font-display text-2xl">{title}</SheetTitle>
          <SheetDescription>
            {target && `من ${dateLabel(target.from)} إلى ${dateLabel(target.to)}`}
            {target?.costCenter && ` — مركز تكلفة: ${findDepartment(db.departments, target.costCenter).name}`}
            {" — اضغط أي سطر لفتح القيد ومستنده."}
          </SheetDescription>
        </SheetHeader>
        {r && (
          <div className="space-y-3 px-4 pb-6">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Mini label="رصيد أول المدة" value={r.opening} />
              <Mini label="مدين" value={r.debit} />
              <Mini label="دائن" value={r.credit} />
              <Mini label="رصيد آخر المدة" value={r.closing} strong />
            </div>
            <TableCard minWidth={640}>
              <thead>
                <HeadRow>
                  <Th>التاريخ</Th>
                  <Th>المستند</Th>
                  <Th>البيان</Th>
                  <Th num>مدين</Th>
                  <Th num>دائن</Th>
                  <Th num>الرصيد</Th>
                </HeadRow>
              </thead>
              <tbody>
                {r.rows.map((x, i) => (
                  <tr
                    key={`${x.entry.id}-${i}`}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                    onClick={() => onEntry(x.entry)}
                  >
                    <Td num className="text-right">{dateLabel(x.entry.date)}</Td>
                    <Td className="font-mono text-xs">
                      <span dir="ltr">{x.entry.number}</span>
                      <p className="font-sans text-[11px] text-muted-foreground">{ENTRY_SOURCE_LABELS[x.entry.source]}</p>
                    </Td>
                    <Td className="max-w-64 truncate">{x.entry.description}</Td>
                    <Td num>{x.line.debit ? money(x.line.debit) : ""}</Td>
                    <Td num>{x.line.credit ? money(x.line.credit) : ""}</Td>
                    <Td num className="font-semibold">{money(x.balance)}</Td>
                  </tr>
                ))}
                {!r.rows.length && <EmptyRow cols={6} text="لا توجد قيود في هذه الفترة." />}
              </tbody>
            </TableCard>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Mini({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("num font-semibold", strong && "text-primary")}>{money(value)}</p>
    </div>
  );
}

export function EntryDialog({ entry, onClose }: { entry: JournalEntry | null; onClose: () => void }) {
  const db = useHospitalDB();
  const accounts = useMemo(() => chartOfAccounts(db), [db]);
  const total = entry?.lines.reduce((s, l) => s + l.debit, 0) ?? 0;
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            قيد يومية <span dir="ltr" className="font-mono text-lg">{entry?.number}</span>
          </DialogTitle>
          <DialogDescription>
            {entry && `${dateLabel(entry.date)} — ${ENTRY_SOURCE_LABELS[entry.source]} — ${entry.description}`}
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <>
            <TableCard minWidth={520}>
              <thead>
                <HeadRow>
                  <Th>الحساب</Th>
                  <Th>مركز التكلفة</Th>
                  <Th num>مدين</Th>
                  <Th num>دائن</Th>
                </HeadRow>
              </thead>
              <tbody>
                {entry.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <Td>
                      <p className="font-semibold">{accountName(accounts, l.account)}</p>
                      <p dir="ltr" className="text-right font-mono text-[11px] text-muted-foreground">{l.account}</p>
                    </Td>
                    <Td className="text-xs">{l.costCenter ? findDepartment(db.departments, l.costCenter).name : "—"}</Td>
                    <Td num>{l.debit ? money(l.debit) : ""}</Td>
                    <Td num>{l.credit ? money(l.credit) : ""}</Td>
                  </tr>
                ))}
                <tr className="bg-secondary/50 font-bold">
                  <Td colSpan={2}>الإجمالي (متوازن)</Td>
                  <Td num>{money(total)}</Td>
                  <Td num>{money(total)}</Td>
                </tr>
              </tbody>
            </TableCard>
            <div className="flex justify-end">
              <Button asChild variant="outline">
                <Link to={sourceRoute(entry)} onClick={onClose}>
                  <ExternalLink /> فتح صفحة المستند الأصلي
                </Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
