import { createFileRoute } from "@tanstack/react-router";
import { BadgePercent, CheckCircle2, Clock, FileDown, RotateCcw } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import {
  BoxSelect,
  EmptyRow,
  FieldRow,
  FilterBar,
  HeadRow,
  matches,
  MethodSelect,
  MonthYearPicker,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { invoiceAmounts } from "@/lib/hospital/finance";
import { dateLabel, egp, int, isoDate, money, monthLabel } from "@/lib/hospital/format";
import {
  collectInsurer,
  listLabel,
  MAIN_BOX_ID,
  uncollectInsurer,
  useCan,
  useHospitalDB,
  type PatientInvoice,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/insurance")({
  head: () => ({
    meta: [
      { title: "مستحقات التأمين والتعاقدات | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "نصيب شركات التأمين والنقابات من فواتير المرضى: المستحق، المحصّل، والمتأخر لكل جهة، وتسجيل التحصيل.",
      },
      { property: "og:title", content: "مستحقات التأمين والتعاقدات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "متابعة مستحقات شركات التأمين والنقابات وتحصيلها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InsurancePage,
});

type Status = "all" | "due" | "collected";

function InsurancePage() {
  const db = useHospitalDB();
  const canAdd = useCan("insurance", "add");
  const canEdit = useCan("insurance");
  const [period, setPeriod] = useState("all");
  const [payer, setPayer] = useState("all");
  const [status, setStatus] = useState<Status>("due");
  const [query, setQuery] = useState("");
  const [collecting, setCollecting] = useState<PatientInvoice | null>(null);
  const pdf = usePdfExport();

  const all = useMemo(
    () =>
      db.patientInvoices
        .filter((i) => i.payer)
        .map((i) => ({ inv: i, a: invoiceAmounts(i) }))
        .filter((r) => r.a.insurerShare > 0)
        .sort((x, y) => x.inv.date.localeCompare(y.inv.date)),
    [db.patientInvoices],
  );
  const inPeriod = all.filter((r) => period === "all" || r.inv.date.startsWith(period));
  const rows = inPeriod.filter(
    (r) =>
      (payer === "all" || r.inv.payer!.payerId === payer) &&
      (status === "all" || (status === "due" ? !r.inv.insurerPaid : !!r.inv.insurerPaid)) &&
      matches(query, r.inv.patientName, r.inv.number),
  );
  const sum = (list: typeof all, f: (r: (typeof all)[number]) => boolean) =>
    list.filter(f).reduce((s, r) => s + r.a.insurerShare, 0);
  const share = sum(inPeriod, () => true);
  const collected = sum(inPeriod, (r) => !!r.inv.insurerPaid);
  const byPayer = useMemo(() => {
    const m = new Map<string, { count: number; share: number; collected: number; oldest: string }>();
    for (const r of inPeriod) {
      const k = r.inv.payer!.payerId;
      const e = m.get(k) ?? { count: 0, share: 0, collected: 0, oldest: "" };
      e.count++;
      e.share += r.a.insurerShare;
      if (r.inv.insurerPaid) e.collected += r.a.insurerShare;
      else if (!e.oldest || r.inv.date < e.oldest) e.oldest = r.inv.date;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].share - b[1].collected - (a[1].share - a[1].collected));
  }, [inPeriod]);
  const payerName = (id: string) => listLabel(db.lists.payers, id);
  const ageDays = (d: string) => Math.floor((Date.now() - Date.parse(`${d}T00:00:00`)) / 86_400_000);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="دورة الإيرادات"
        title="مستحقات التأمين والتعاقدات"
        description="لما المريض يكون على شركة تأمين أو نقابة، نصيب الجهة بيتسجل هنا كمستحق لحد ما يتحصّل، والتحصيل بيدخل الخزينة اللي تختارها."
        actions={
          <Button
            variant="outline"
            disabled={pdf.busy}
            onClick={() => pdf.run(`مستحقات-التأمين-${period}.pdf`, "تم تصدير كشف مستحقات التأمين.")}
          >
            <FileDown /> تصدير PDF
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="نصيب الجهات" value={money(share)} icon={BadgePercent} tone="primary" hint="ج.م" />
        <StatCard label="تم تحصيله" value={money(collected)} icon={CheckCircle2} tone="income" hint="ج.م" />
        <StatCard label="مستحق لم يُحصّل" value={money(share - collected)} icon={Clock} tone="expense" hint="ج.م" />
        <StatCard label="فواتير على جهات" value={int(inPeriod.length)} icon={BadgePercent} />
      </div>

      {byPayer.length > 0 && (
        <section className="ledger-card mb-6 overflow-hidden">
          <h2 className="border-b bg-secondary/60 px-4 py-3 font-bold">الرصيد لكل جهة</h2>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {byPayer.map(([id, e]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPayer(payer === id ? "all" : id)}
                className={cn("bg-card p-4 text-right hover:bg-muted/50", payer === id && "bg-secondary")}
              >
                <p className="font-semibold">{payerName(id)}</p>
                <p className="num mt-1 text-lg font-bold text-expense">{egp(e.share - e.collected)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {int(e.count)} فاتورة • محصّل {money(e.collected)} من {money(e.share)}
                  {e.oldest ? ` • أقدم مستحق من ${int(ageDays(e.oldest))} يوم` : ""}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} allowAll />
        <Select value={payer} onValueChange={setPayer}>
          <SelectTrigger className="bg-card md:w-52" aria-label="الجهة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الجهات</SelectItem>
            {db.lists.payers.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="bg-card md:w-40" aria-label="الحالة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="due">لم يُحصّل</SelectItem>
            <SelectItem value="collected">تم التحصيل</SelectItem>
            <SelectItem value="all">الكل</SelectItem>
          </SelectContent>
        </Select>
        <SearchBox value={query} onChange={setQuery} placeholder="اسم المريض أو رقم الإيصال" className="md:flex-1" />
      </FilterBar>

      <TableCard minWidth={960}>
        <thead>
          <HeadRow>
            <Th>التاريخ</Th>
            <Th>الإيصال</Th>
            <Th>المريض / القسم</Th>
            <Th>الجهة</Th>
            <Th num>صافي الفاتورة</Th>
            <Th num>نصيب الجهة</Th>
            <Th>الحالة</Th>
            <Th className="w-28" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map(({ inv, a }) => (
            <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td num className="text-right">{dateLabel(inv.date)}</Td>
              <Td className="font-mono text-xs"><span dir="ltr">{inv.number}</span></Td>
              <Td>
                <p className="mb-1">{inv.patientName}</p>
                <DeptBadge id={inv.department} />
              </Td>
              <Td className="text-sm">
                {payerName(inv.payer!.payerId)}
                <p className="text-[11px] text-muted-foreground">تغطية {a.coverage}%</p>
              </Td>
              <Td num>{money(a.total)}</Td>
              <Td num className="font-bold">{money(a.insurerShare)}</Td>
              <Td className="text-xs">
                {inv.insurerPaid ? (
                  <span className="font-semibold text-income">حُصّل {dateLabel(inv.insurerPaid.date)}</span>
                ) : (
                  <span className="text-copper">مستحق منذ {int(ageDays(inv.date))} يوم</span>
                )}
              </Td>
              <Td>
                {!inv.insurerPaid && canAdd && (
                  <Button size="sm" onClick={() => setCollecting(inv)}>تحصيل</Button>
                )}
                {inv.insurerPaid && canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.confirm("إلغاء التحصيل وحذف قيده من الخزينة؟") && uncollectInsurer(inv.id) && toast.success("تم إلغاء التحصيل.")}
                  >
                    <RotateCcw /> إلغاء
                  </Button>
                )}
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={8} text="لا توجد فواتير على جهات بهذه الفلاتر." />}
        </tbody>
      </TableCard>

      <CollectDialog inv={collecting} onClose={() => setCollecting(null)} />

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        title="كشف مستحقات التأمين والتعاقدات"
        subtitle={`${period === "all" ? "كل الفترات" : `شهر ${monthLabel(period)}`}${payer !== "all" ? ` — ${payerName(payer)}` : ""}`}
        issuedOn={dateLabel(isoDate(new Date()))}
      >
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>التاريخ</th>
              <th>الإيصال</th>
              <th>المريض</th>
              <th>الجهة</th>
              <th>نصيب الجهة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ inv, a }) => (
              <tr key={inv.id} data-pdf-break>
                <td>{dateLabel(inv.date)}</td>
                <td dir="ltr">{inv.number}</td>
                <td className="text-start">{inv.patientName}</td>
                <td>{payerName(inv.payer!.payerId)}</td>
                <td>{money(a.insurerShare)}</td>
                <td>{inv.insurerPaid ? "محصّل" : "مستحق"}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={4} className="text-start">الإجمالي</td>
              <td>{money(rows.reduce((s, r) => s + r.a.insurerShare, 0))}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["مسؤول التعاقدات", "المدير المالي"]} />
      </OfficialDocument>
    </div>
  );
}

function CollectDialog({ inv, onClose }: { inv: PatientInvoice | null; onClose: () => void }) {
  const db = useHospitalDB();
  const [date, setDate] = useState(isoDate(new Date()));
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [method, setMethod] = useState("");
  useEffect(() => {
    if (inv) {
      setDate(isoDate(new Date()));
      setBoxId(MAIN_BOX_ID);
      setMethod(db.lists.paymentMethods.find((m) => m.id !== "cash")?.id ?? db.lists.paymentMethods[0]?.id ?? "cash");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv]);
  const share = inv ? invoiceAmounts(inv).insurerShare : 0;
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inv && collectInsurer(inv.id, date, boxId, method)) {
      toast.success(`تم تسجيل تحصيل ${egp(share)}.`);
      onClose();
    }
  }
  return (
    <Dialog open={!!inv} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">تحصيل من الجهة</DialogTitle>
          <DialogDescription>
            {inv ? `${inv.patientName} — إيصال ${inv.number} — نصيب الجهة ${egp(share)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FieldRow label="تاريخ التحصيل" htmlFor="ins-date">
            <Input id="ins-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="إلى خزينة">
              <BoxSelect value={boxId} onChange={setBoxId} />
            </FieldRow>
            <FieldRow label="طريقة التحصيل">
              <MethodSelect value={method} onChange={setMethod} />
            </FieldRow>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">تسجيل التحصيل</Button>
            <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
