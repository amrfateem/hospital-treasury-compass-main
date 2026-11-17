import { createFileRoute } from "@tanstack/react-router";
import { Banknote, ClipboardList, FileDown, Scale, Trash2, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import {
  BoxSelect,
  DocInfoGrid,
  EmptyRow,
  FieldRow,
  HeadRow,
  matches,
  MethodSelect,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { supplierBalances, supplierStatement } from "@/lib/hospital/finance";
import { dateLabel, egp, int, isoDate, money } from "@/lib/hospital/format";
import {
  canSpendDirectly,
  deleteSupplierPayment,
  MAIN_BOX_ID,
  saveSupplierPayment,
  useCan,
  useHospitalDB,
  useHospitalSession,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/supplier-accounts")({
  head: () => ({
    meta: [
      { title: "كشف حساب الموردين | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "رصيد كل مورد: الفواتير الآجلة والنقدية والسداد، وكشف حساب تفصيلي برصيد جاري لكل مورد مع تسجيل السداد.",
      },
      { property: "og:title", content: "كشف حساب الموردين | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "أرصدة الموردين وكشوف الحساب والسداد." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierAccountsPage,
});

function SupplierAccountsPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canAdd = useCan("supplierAccounts", "add");
  const canEdit = useCan("supplierAccounts");
  const direct = !!me && canSpendDirectly(me);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const pdf = usePdfExport();

  const balances = useMemo(
    () => supplierBalances(db.supplierInvoices, db.supplierPayments),
    [db.supplierInvoices, db.supplierPayments],
  );
  const list = balances.filter((b) => matches(query, b.name));
  const current = selected ?? balances[0]?.name ?? null;
  const st = useMemo(
    () => (current ? supplierStatement(db.supplierInvoices, db.supplierPayments, current) : null),
    [db.supplierInvoices, db.supplierPayments, current],
  );
  const totalDue = balances.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const paymentOf = (ref: string) => db.supplierPayments.find((p) => p.number === ref);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المصروفات"
        title="كشف حساب الموردين"
        description="كل فاتورة آجلة تزوّد رصيد المورد، وكل سداد يقلّله. الفواتير النقدية بتظهر مسددة في نفس السطر. المبالغ بعد خصم ضريبة الخصم والإضافة."
        actions={
          <>
            {direct && canAdd && current && (
              <Button onClick={() => setPaying(true)}>
                <Banknote /> سداد للمورد
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pdf.busy || !st}
              onClick={() => pdf.run(`كشف-حساب-${current ?? "مورد"}.pdf`, "تم تصدير كشف الحساب.")}
            >
              <FileDown /> تصدير PDF
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="عدد الموردين" value={int(balances.length)} icon={Truck} />
        <StatCard label="إجمالي المستحق للموردين" value={money(totalDue)} icon={Scale} tone="expense" hint="ج.م" />
        <StatCard label="إجمالي الفواتير" value={money(balances.reduce((s, b) => s + b.invoiced, 0))} icon={ClipboardList} hint="ج.م" />
        <StatCard label="إجمالي المسدد" value={money(balances.reduce((s, b) => s + b.paid, 0))} icon={Banknote} tone="income" hint="ج.م" />
      </div>

      {!direct && canAdd && (
        <p className="mb-4 rounded-lg border border-dashed bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          السداد للموردين للمدير المالي أو مدير المستشفى فقط — لأي سداد اعمل أمر صرف من صفحة أوامر الصرف.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section className="ledger-card h-fit overflow-hidden">
          <div className="border-b p-3">
            <SearchBox value={query} onChange={setQuery} placeholder="ابحث عن مورد" />
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {list.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => setSelected(b.name)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 border-b px-4 py-3 text-right text-sm last:border-0 hover:bg-muted/60",
                    current === b.name && "bg-secondary",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{b.name}</span>
                    {b.lastDate && <span className="text-[11px] text-muted-foreground">آخر حركة {dateLabel(b.lastDate)}</span>}
                  </span>
                  <span className={cn("num shrink-0 font-bold", b.balance > 0 ? "text-expense" : "text-muted-foreground")}>
                    {money(b.balance)}
                  </span>
                </button>
              </li>
            ))}
            {!list.length && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                لا يوجد موردون بعد — سجّل فواتير الموردين من صفحة مشتريات الموردين.
              </li>
            )}
          </ul>
        </section>

        <div>
          {st && current && (
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">{current}</h2>
              <p className="text-sm">
                الرصيد المستحق: <b className={cn("num", st.balance > 0 ? "text-expense" : "text-income")}>{egp(st.balance)}</b>
              </p>
            </div>
          )}
          <TableCard minWidth={600}>
            <thead>
              <HeadRow>
                <Th>التاريخ</Th>
                <Th>المرجع</Th>
                <Th>البيان</Th>
                <Th num>مدين (علينا)</Th>
                <Th num>دائن (مسدد)</Th>
                <Th num>الرصيد</Th>
                <Th className="w-12" />
              </HeadRow>
            </thead>
            <tbody>
              {st?.lines.map((l, i) => {
                const pay = paymentOf(l.ref);
                return (
                  <tr key={`${l.ref}-${i}`} className="border-b last:border-0 hover:bg-muted/50">
                    <Td num className="text-right">{dateLabel(l.date)}</Td>
                    <Td className="font-mono text-xs whitespace-nowrap"><span dir="ltr">{l.ref}</span></Td>
                    <Td className="text-sm">{l.description}</Td>
                    <Td num>{l.debit ? money(l.debit) : "—"}</Td>
                    <Td num className="text-income">{l.credit ? money(l.credit) : "—"}</Td>
                    <Td num className="font-bold">{money(l.balance)}</Td>
                    <Td>
                      {pay && canEdit && direct && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="حذف السداد"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => window.confirm(`حذف السداد ${pay.number}؟`) && deleteSupplierPayment(pay.id) && toast.success("تم حذف السداد.")}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {!st?.lines.length && <EmptyRow cols={7} text="اختر موردًا لعرض كشف حسابه." />}
              {st && st.lines.length > 0 && (
                <tr className="bg-secondary/60 font-bold">
                  <Td colSpan={3}>الإجمالي</Td>
                  <Td num>{money(st.debit)}</Td>
                  <Td num>{money(st.credit)}</Td>
                  <Td num>{money(st.balance)}</Td>
                  <Td />
                </tr>
              )}
            </tbody>
          </TableCard>
        </div>
      </div>

      <PayDialog open={paying} supplier={current} due={st?.balance ?? 0} onClose={() => setPaying(false)} />

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        title="كشف حساب مورد"
        subtitle={current ?? ""}
        issuedOn={dateLabel(isoDate(new Date()))}
      >
        <DocInfoGrid
          items={[
            ["المورد", current ?? ""],
            ["الرصيد المستحق", egp(st?.balance ?? 0)],
          ]}
        />
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>التاريخ</th>
              <th>المرجع</th>
              <th>البيان</th>
              <th>مدين</th>
              <th>دائن</th>
              <th>الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {st?.lines.map((l, i) => (
              <tr key={`${l.ref}-${i}`} data-pdf-break>
                <td>{dateLabel(l.date)}</td>
                <td dir="ltr">{l.ref}</td>
                <td className="text-start">{l.description}</td>
                <td>{l.debit ? money(l.debit) : "—"}</td>
                <td>{l.credit ? money(l.credit) : "—"}</td>
                <td>{money(l.balance)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={3} className="text-start">الإجمالي</td>
              <td>{money(st?.debit ?? 0)}</td>
              <td>{money(st?.credit ?? 0)}</td>
              <td>{money(st?.balance ?? 0)}</td>
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["المحاسب", "المدير المالي", "المورد"]} />
      </OfficialDocument>
    </div>
  );
}

function PayDialog({
  open,
  supplier,
  due,
  onClose,
}: {
  open: boolean;
  supplier: string | null;
  due: number;
  onClose: () => void;
}) {
  const db = useHospitalDB();
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState("");
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setDate(isoDate(new Date()));
      setAmount(due > 0 ? String(due) : "");
      setBoxId(MAIN_BOX_ID);
      setMethod(db.lists.paymentMethods[0]?.id ?? "cash");
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplier) return;
    const v = Number(amount);
    if (saveSupplierPayment({ supplierName: supplier, date, amount: v, boxId, method, note })) {
      toast.success(`تم تسجيل سداد ${egp(v)} لـ ${supplier}.`);
      onClose();
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">سداد للمورد</DialogTitle>
          <DialogDescription>
            {supplier} — الرصيد المستحق {egp(due)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="sp-date">
              <Input id="sp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </FieldRow>
            <FieldRow label="المبلغ (ج.م)" htmlFor="sp-amount">
              <Input id="sp-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FieldRow>
            <FieldRow label="من خزينة">
              <BoxSelect value={boxId} onChange={setBoxId} />
            </FieldRow>
            <FieldRow label="طريقة الدفع">
              <MethodSelect value={method} onChange={setMethod} />
            </FieldRow>
          </div>
          <FieldRow label="ملاحظة (اختياري)" htmlFor="sp-note">
            <Input id="sp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: شيك رقم ..." />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">تسجيل السداد</Button>
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
