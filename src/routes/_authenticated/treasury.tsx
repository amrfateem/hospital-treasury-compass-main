import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, FileDown, HandCoins, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { BoxSelect, DeptSelect, matches, SearchBox } from "@/components/hospital/kit";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeptBadge, KindBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { findDepartment, GENERAL_DEPT_ID, type LedgerDepartment } from "@/lib/hospital/constants";
import { dateLabel, egp, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import { exportOfficialPdf } from "@/lib/hospital/pdf";
import { toEgp } from "@/lib/hospital/branches";
import {
  addTransaction,
  deleteTransaction,
  fundCashbox,
  updateTransaction,
  useHospitalDB,
  TX_SOURCE_LABELS,
  withRunningBalance,
  type Transaction,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";
import { MainTreasuryPanel } from "@/components/hospital/treasury/MainTreasuryPanel";
import { ICU_BOX_ID, MAIN_BOX_ID } from "@/lib/hospital/model";
import { isDeskRole } from "@/lib/hospital/permissions";
import { useHospitalSession } from "@/lib/hospital/store";

type TransferInfo = { number: string; from: string; to: string; note?: string | undefined };
type LedgerRow = Transaction & { transfer?: TransferInfo | undefined };

export const Route = createFileRoute("/_authenticated/treasury")({
  head: () => ({
    meta: [
      { title: "حركة الخزينة — الداخل والخارج | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "دفتر الخزينة اليومي لكل الإيرادات والمصروفات موزعة على أقسام المستشفى مع الرصيد الجاري.",
      },
      { property: "og:title", content: "حركة الخزينة | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "الداخل والخارج والرصيد الجاري لكل مراكز التكلفة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TreasuryPage,
});

const SOURCE_LABEL = TX_SOURCE_LABELS;

function TreasuryPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const seesWholeTreasury = !!me && !isDeskRole(me.role);
  const [scope, setScope] = useState<string>("all");
  const tableRef = useRef<HTMLDivElement>(null);
  const boxName = (id: string | undefined) =>
    db.cashboxes.find((b) => b.id === (id ?? MAIN_BOX_ID))?.name ?? "خزينة محذوفة";
  const [period, setPeriod] = useState<string>(() => periodOf(new Date()));
  const [dept, setDept] = useState<"all" | LedgerDepartment>("all");
  const [kind, setKind] = useState<"all" | "in" | "out">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  const periods = useMemo(() => {
    const set = new Set(db.transactions.map((t) => t.date.slice(0, 7)));
    set.add(periodOf(new Date()));
    return [...set].sort().reverse();
  }, [db.transactions]);

  const { rows, opening, totalIn, totalOut } = useMemo(() => {
    // Transfers between the main treasury and the bank accounts: shown only when one box is picked
    // (for the whole hospital they cancel out — money moving inside the hospital is not income).
    const boxes = scope === "all" ? null : new Set([scope]);
    const moves: LedgerRow[] =
      boxes && dept === "all"
        ? db.transfers
            .filter((t) => boxes.has(t.from) !== boxes.has(t.to))
            .map((t) => {
              const inbound = boxes.has(t.to);
              return {
                id: t.id,
                date: t.date,
                createdAt: t.createdAt,
                kind: inbound ? ("in" as const) : ("out" as const),
                amount: t.amount,
                boxId: inbound ? t.to : t.from,
                department: GENERAL_DEPT_ID,
                description: inbound ? `تحويل وارد من ${boxName(t.from)}` : `تحويل إلى ${boxName(t.to)}`,
                receiptId: t.number,
                source: "manual" as const,
                transfer: { number: t.number, from: t.from, to: t.to, note: t.note },
              };
            })
        : [];
    const matches: LedgerRow[] = [
      ...db.transactions.filter((t) => !boxes || boxes.has(t.boxId ?? MAIN_BOX_ID)),
      ...moves,
    ].filter(
      (t) => (dept === "all" || t.department === dept) && (kind === "all" || t.kind === kind),
    );
    const before = period === "all" ? [] : matches.filter((t) => t.date.slice(0, 7) < period);
    const inPeriod = (
      period === "all" ? matches : matches.filter((t) => t.date.slice(0, 7) === period)
    ).filter((t) => matchText(query, t.description, t.receiptId));
    const opening = before.reduce((s, t) => s + (t.kind === "in" ? t.amount : -t.amount), 0);
    const rows = withRunningBalance(inPeriod, opening);
    const totalIn = inPeriod.filter((t) => t.kind === "in").reduce((s, t) => s + t.amount, 0);
    const totalOut = inPeriod.filter((t) => t.kind === "out").reduce((s, t) => s + t.amount, 0);
    return { rows, opening, totalIn, totalOut };
  }, [db.transactions, db.transfers, db.cashboxes, period, dept, kind, query, scope]);

  const closing = opening + totalIn - totalOut;
  const scopeName =
    scope === "all" ? "" : ` — ${boxName(scope)}`;
  const docScope = `${period === "all" ? "كل الفترات" : `شهر ${monthLabel(period)}`} — ${dept === "all" ? "جميع الأقسام" : findDepartment(db.departments, dept).name}${scopeName}`;

  async function handleExport() {
    if (!docRef.current) return;
    setExporting(true);
    try {
      await exportOfficialPdf(docRef.current, `حركة-الخزينة-${period}.pdf`);
      toast.success("تم تصدير دفتر الخزينة.");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر إنشاء ملف PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الخزينة — الداخل والخارج"
        title="حركة الخزينة اليومية"
        description="دفتر أستاذ لكل حركة نقدية، مرتبطة بمركز التكلفة، مع الرصيد الجاري بعد كل قيد."
        actions={
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus /> قيد جديد
            </Button>
            {me?.role === "admin" && (
              <Button variant="secondary" onClick={() => setFundOpen(true)}>
                <HandCoins /> تمويل من صاحب المستشفى
              </Button>
            )}
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              <FileDown /> {exporting ? "جارٍ التصدير..." : "تصدير PDF"}
            </Button>
          </>
        }
      />

      {seesWholeTreasury && <MainTreasuryPanel period={period} />}

      <div
        className={cn(
          "ledger-card mb-6 grid gap-3 p-4 sm:grid-cols-2",
          seesWholeTreasury ? "lg:grid-cols-5" : "lg:grid-cols-4",
        )}
      >
        {seesWholeTreasury && (
          <FilterSelect label="الخزينة / الحساب البنكي" value={scope} onChange={setScope}>
            <SelectItem value="all">كل الحركات (الخزينة والبنوك)</SelectItem>
            {db.cashboxes.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </FilterSelect>
        )}
        <FilterSelect label="الفترة" value={period} onChange={setPeriod}>
          <SelectItem value="all">كل الفترات</SelectItem>
          {periods.map((p) => (
            <SelectItem key={p} value={p}>
              {monthLabel(p)}
            </SelectItem>
          ))}
        </FilterSelect>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">القسم</Label>
          <DeptSelect value={dept} onChange={setDept} allowAll />
        </div>
        <FilterSelect label="نوع الحركة" value={kind} onChange={(v) => setKind(v as typeof kind)}>
          <SelectItem value="all">الكل</SelectItem>
          <SelectItem value="in">إيراد (داخل)</SelectItem>
          <SelectItem value="out">مصروف (خارج)</SelectItem>
        </FilterSelect>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">بحث</Label>
          <SearchBox value={query} onChange={setQuery} placeholder="البيان أو رقم الإيصال" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="رصيد أول المدة" value={money(opening)} icon={Scale} />
        <StatCard label="إجمالي الداخل" value={money(totalIn)} icon={ArrowDownLeft} tone="income" />
        <StatCard
          label="إجمالي الخارج"
          value={money(totalOut)}
          icon={ArrowUpRight}
          tone="expense"
        />
        <StatCard
          label="رصيد آخر المدة"
          value={money(closing)}
          icon={Scale}
          tone="primary"
          hint="بالجنيه المصري"
        />
      </div>

      <div ref={tableRef} className="ledger-card scroll-mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b bg-secondary/60 text-xs text-secondary-foreground">
                <th className="px-3 py-3 text-right font-semibold">التاريخ</th>
                <th className="px-3 py-3 text-right font-semibold">رقم الإيصال</th>
                <th className="px-3 py-3 text-right font-semibold">القسم</th>
                <th className="px-3 py-3 text-right font-semibold">النوع</th>
                <th className="px-3 py-3 text-right font-semibold">البيان</th>
                <th className="px-3 py-3 text-left font-semibold">الداخل</th>
                <th className="px-3 py-3 text-left font-semibold">الخارج</th>
                <th className="px-3 py-3 text-left font-semibold">الرصيد</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="num px-3 py-3">{dateLabel(t.date)}</td>
                  <td className="px-3 py-3 font-mono text-xs" dir="ltr">
                    {t.receiptId}
                  </td>
                  <td className="px-3 py-3">
                    {t.transfer ? (
                      <span className="text-xs text-muted-foreground">تحويل خزائن</span>
                    ) : (
                      <DeptBadge id={t.department} />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <KindBadge kind={t.kind} />
                  </td>
                  <td className="px-3 py-3">
                    <p>{t.description}</p>
                    {t.fx && (
                      <p className="text-[11px] text-muted-foreground" dir="rtl">
                        {money(t.fx.amount)} {t.fx.currency} × {t.fx.rate}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {t.transfer ? "تحويل بين الخزائن" : SOURCE_LABEL[t.source]}
                      {seesWholeTreasury && ` · ${boxName(t.boxId)}`}
                    </p>
                  </td>
                  <td className="num px-3 py-3 text-left font-semibold text-income">
                    {t.kind === "in" ? money(t.amount) : "—"}
                  </td>
                  <td className="num px-3 py-3 text-left font-semibold text-expense">
                    {t.kind === "out" ? money(t.amount) : "—"}
                  </td>
                  <td
                    className={cn(
                      "num px-3 py-3 text-left font-bold",
                      t.balance < 0 && "text-destructive",
                    )}
                  >
                    {money(t.balance)}
                  </td>
                  <td className="px-2 py-3">
                    {t.transfer ? (
                      <span className="block text-left text-[10px] text-muted-foreground">
                        من الورديات / التحويلات
                      </span>
                    ) : t.source === "manual" || t.source === "opening" ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="تعديل القيد"
                          onClick={() => {
                            setEditing(t);
                            setOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="حذف القيد"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (window.confirm(`حذف القيد ${t.receiptId}؟`)) {
                              deleteTransaction(t.id);
                              toast.success("تم حذف القيد.");
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ) : (
                      <span
                        className="block text-left text-[10px] text-muted-foreground"
                        title="يُعدَّل من صفحته الأصلية"
                      >
                        من {SOURCE_LABEL[t.source]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-14 text-center text-muted-foreground">
                    لا توجد حركات في هذه الفترة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TransactionDialog
        open={open}
        onOpenChange={setOpen}
        tx={editing}
        defaultDepartment={dept === "all" ? GENERAL_DEPT_ID : dept}
      />
      <FundDialog open={fundOpen} onOpenChange={setFundOpen} />

      <OfficialDocument
        ref={docRef}
        settings={db.settings}
        title="دفتر حركة الخزينة (الداخل والخارج)"
        subtitle={docScope}
        issuedOn={dateLabel(isoDate(new Date()))}
        orientation="landscape"
      >
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>التاريخ</th>
              <th>رقم الإيصال</th>
              <th>القسم</th>
              <th>النوع</th>
              <th>البيان</th>
              <th>الداخل</th>
              <th>الخارج</th>
              <th>الرصيد الجاري</th>
            </tr>
          </thead>
          <tbody>
            <tr className="doc-subtotal" data-pdf-break>
              <td colSpan={7} className="text-start">
                رصيد أول المدة
              </td>
              <td>{money(opening)}</td>
            </tr>
            {rows.map((t) => (
              <tr key={t.id} data-pdf-break>
                <td>{dateLabel(t.date)}</td>
                <td dir="ltr">{t.receiptId}</td>
                <td>{t.transfer ? "تحويل خزائن" : findDepartment(db.departments, t.department).name}</td>
                <td>{t.kind === "in" ? "إيراد" : "مصروف"}</td>
                <td className="text-start">{t.description}</td>
                <td>{t.kind === "in" ? money(t.amount) : "—"}</td>
                <td>{t.kind === "out" ? money(t.amount) : "—"}</td>
                <td>{money(t.balance)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={5} className="text-start">
                الإجمالي ({int(rows.length)} حركة)
              </td>
              <td>{money(totalIn)}</td>
              <td>{money(totalOut)}</td>
              <td>{money(closing)}</td>
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["أمين الخزينة", "المحاسب المختص", "المدير المالي"]} />
      </OfficialDocument>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">{children}</SelectContent>
      </Select>
    </div>
  );
}

function matchText(q: string, ...f: string[]) {
  return matches(q, ...f);
}

function FundDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [boxId, setBoxId] = useState(ICU_BOX_ID);
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBoxId(ICU_BOX_ID);
    setDate(isoDate(new Date()));
    setAmount("");
    setNote("");
    setError("");
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return setError("اكتب مبلغ التمويل.");
    setBusy(true);
    if (fundCashbox(boxId, date, n, note.trim() || undefined)) {
      toast.success("تم تسجيل تمويل صاحب المستشفى — لا يدخل في الإيرادات.");
      onOpenChange(false);
    } else {
      setError("تعذّر تسجيل التمويل.");
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">تمويل من صاحب المستشفى</DialogTitle>
          <DialogDescription>
            يُضاف رصيد للخزينة المختارة ويُسجَّل كجاري صاحب المستشفى — مش إيراد، ومحدش يظهر كمحصّل.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>الخزينة</Label>
            <BoxSelect value={boxId} onChange={setBoxId} cashOnly />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fund-date">التاريخ</Label>
            <Input id="fund-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fund-amount">المبلغ (ج.م)</Label>
            <Input
              id="fund-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fund-note">ملاحظات (اختياري)</Label>
            <Input id="fund-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تمويل تشغيل العناية" />
          </div>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "جارٍ التسجيل..." : "تسجيل التمويل"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransactionDialog({
  open,
  onOpenChange,
  tx,
  defaultDepartment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tx: Transaction | null;
  defaultDepartment: LedgerDepartment;
}) {
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [department, setDepartment] = useState<LedgerDepartment>(defaultDepartment);
  const [kind, setKind] = useState<"in" | "out">("in");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const { settings } = useHospitalDB();
  const currencies = (settings.currencies ?? []).filter((c) => c.code);
  const [currency, setCurrency] = useState("EGP");
  const [rate, setRate] = useState("");
  const foreign = currency !== "EGP";

  useEffect(() => {
    if (!open) return;
    setError("");
    setDate(tx?.date ?? isoDate(new Date()));
    setDepartment(tx?.department ?? defaultDepartment);
    setKind(tx?.kind ?? "in");
    setDescription(tx?.description ?? "");
    setAmount(tx ? String(tx.amount) : "");
    setBoxId(tx?.boxId ?? MAIN_BOX_ID);
    setOpening(tx?.source === "opening");
    setCurrency(tx?.fx?.currency ?? "EGP");
    setRate(tx?.fx ? String(tx.fx.rate) : "");
    if (tx?.fx) setAmount(String(tx.fx.amount));
  }, [open, tx, defaultDepartment]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    const desc = description.trim() || (opening ? "رصيد افتتاحي للخزينة" : "");
    if (!desc) return setError("اكتب بيان الحركة.");
    if (!(value > 0)) return setError("المبلغ يجب أن يكون أكبر من صفر.");
    if (foreign && !(Number(rate) > 0)) return setError("اكتب سعر الصرف بالجنيه.");
    const fx = foreign ? { currency, amount: value, rate: Number(rate) } : undefined;
    const egpValue = fx ? toEgp(value, fx.rate) : value;
    if (tx) {
      updateTransaction(tx.id, { date, department, kind, description: desc, amount: egpValue, boxId, ...(fx ? { fx } : {}) });
      toast.success("تم تعديل القيد.");
    } else {
      addTransaction({
        date,
        department: opening ? GENERAL_DEPT_ID : department,
        kind: opening ? "in" : kind,
        description: desc,
        amount: egpValue,
        fx,
        boxId,
        source: opening ? "opening" : "manual",
      });
      toast.success(
        `تم تسجيل ${opening ? "الرصيد الافتتاحي" : kind === "in" ? "إيراد" : "مصروف"} بقيمة ${egp(egpValue)}.`,
      );
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {tx ? "تعديل قيد خزينة" : "قيد خزينة جديد"}
          </DialogTitle>
          <DialogDescription>
            {tx ? (
              <>
                رقم الإيصال: <span dir="ltr">{tx.receiptId}</span>
              </>
            ) : (
              "يُضاف رقم الإيصال تلقائيًا."
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {!tx && (
            <label className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
              <Checkbox checked={opening} onCheckedChange={(c) => setOpening(c === true)} />
              رصيد افتتاحي للخزينة (لا يدخل في الأرباح والخسائر)
            </label>
          )}
          {!opening && (
            <div className="grid grid-cols-2 gap-2">
              {(["in", "out"] as const).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors",
                    kind === k
                      ? k === "in"
                        ? "border-income bg-income/10 text-income"
                        : "border-expense bg-expense/10 text-expense"
                      : "text-muted-foreground",
                  )}
                >
                  {k === "in" ? "إيراد (داخل)" : "مصروف (خارج)"}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tx-date">التاريخ</Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            {!opening && (
              <div className="grid gap-1.5">
                <Label>القسم</Label>
                <DeptSelect value={department} onChange={setDepartment} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>الخزينة</Label>
              <BoxSelect value={boxId} onChange={setBoxId} cashOnly />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tx-desc">البيان</Label>
            <Input
              id="tx-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={opening ? "رصيد افتتاحي للخزينة" : "مثال: إيراد أشعة رنين"}
            />
          </div>
          {currencies.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label>العملة</Label>
                <Select value={currency} onValueChange={(v) => { setCurrency(v); setRate(String(currencies.find((c) => c.code === v)?.rate || "")); }}>
                  <SelectTrigger aria-label="العملة"><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="EGP">جنيه مصري</SelectItem>
                    {currencies.map((c) => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {foreign && (
                <div className="grid gap-1.5">
                  <Label htmlFor="tx-rate">سعر الصرف (ج.م لكل {currency})</Label>
                  <Input id="tx-rate" type="number" min="0" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} />
                </div>
              )}
            </div>
          )}
          {foreign && Number(amount) > 0 && Number(rate) > 0 && (
            <p className="-mt-2 text-xs text-muted-foreground">يعادل {egp(toEgp(Number(amount), Number(rate)))} — يُسجَّل بالجنيه في الحسابات.</p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="tx-amount">المبلغ ({foreign ? currency : "ج.م"})</Label>
            <Input
              id="tx-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">{tx ? "حفظ التعديلات" : "تسجيل القيد"}</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
