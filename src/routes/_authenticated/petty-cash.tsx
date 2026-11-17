import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, Coins, FileDown, HandCoins, Hourglass, Plus, Receipt, Trash2 } from "lucide-react";
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
  DeptSelect,
  EmptyRow,
  FieldRow,
  FilterBar,
  HeadRow,
  matches,
  MonthYearPicker,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { StatusBadge } from "@/components/hospital/orders/StatusBadge";
import { findDepartment, GENERAL_DEPT_ID } from "@/lib/hospital/constants";
import { boxBalance } from "@/lib/hospital/finance";
import { groupTotals } from "@/lib/hospital/expenses";
import { dateLabel, egp, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  addPettyExpense,
  canSpendDirectly,
  deletePettyExpense,
  deletePettyRequest,
  listLabel,
  MAIN_BOX_ID,
  ORDER_STATUS_LABELS,
  payPettyRequest,
  requestPetty,
  useCan,
  useHospitalDB,
  useHospitalSession,
} from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated/petty-cash")({
  head: () => ({
    meta: [
      { title: "النثريات — مصروفات صغيرة من الخزينة الرئيسية | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "طلبات واعتماد وصرف النثريات من الخزينة الرئيسية مباشرة، مع المنصرف حسب البند والقسم.",
      },
      { property: "og:title", content: "النثريات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "دفتر النثريات المنصرفة من الخزينة الرئيسية حسب البند والقسم." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PettyCashPage,
});

function PettyCashPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canEdit = useCan("pettyCash");
  const canAdd = useCan("pettyCash", "add");
  const direct = !!me && canSpendDirectly(me);
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const pdf = usePdfExport();

  // Petty cash has no box of its own: every petty spend leaves the main treasury.
  const balance = boxBalance(MAIN_BOX_ID, db.transactions, db.transfers);
  const all = useMemo(
    () => db.transactions.filter((t) => t.source === "petty" && t.kind === "out"),
    [db.transactions],
  );
  const { rows, spent, ytd } = useMemo(() => {
    const inP = (period === "all" ? all : all.filter((t) => t.date.startsWith(period))).filter((t) =>
      matches(query, t.description, t.receiptId, t.paidTo, t.by),
    );
    const year = (period === "all" ? periodOf(new Date()) : period).slice(0, 4);
    return {
      rows: [...inP].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
      spent: inP.reduce((s, t) => s + t.amount, 0),
      ytd: all.filter((t) => t.date.startsWith(year)).reduce((s, t) => s + t.amount, 0),
    };
  }, [all, period, query]);
  const waiting = db.pettyRequests.filter((r) => r.status === "pending" || r.status === "approved");
  const byCat = useMemo(
    () =>
      groupTotals(rows, (r) => ({
        id: r.category ?? "-",
        label: r.category ? listLabel(db.lists.pettyCategories, r.category) : "أخرى",
      })),
    [rows, db.lists.pettyCategories],
  );
  const byDept = useMemo(
    () => groupTotals(rows, (r) => ({ id: r.department, label: findDepartment(db.departments, r.department).name })),
    [rows, db.departments],
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المصروفات"
        title="النثريات"
        description="المصروفات الصغيرة اليومية بتتصرف من الخزينة الرئيسية مباشرة — مفيش خزينة نثريات منفصلة. أي صرف يتم بطلب يعتمده المدير المالي أولًا، وبعد الصرف بيتسجل تلقائيًا في المصروفات تحت حساب النثريات."
        actions={
          <>
            {canAdd && (
              <Button onClick={() => setDialog(true)}>
                <Plus /> {direct ? "صرف نثرية" : "طلب صرف نثرية"}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pdf.busy}
              onClick={() => pdf.run(`دفتر-النثريات-${period}.pdf`, "تم تصدير دفتر النثريات.")}
            >
              <FileDown /> تصدير PDF
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="رصيد الخزينة الرئيسية (اللي بتتصرف منه)" value={money(balance)} icon={Coins} tone="primary" hint="ج.م" />
        <StatCard label="منصرف نثريات الفترة" value={money(spent)} icon={ArrowUpRight} tone="expense" hint={`${rows.length} عملية صرف`} />
        <StatCard label="منصرف النثريات من أول السنة" value={money(ytd)} icon={Receipt} />
        <StatCard label="طلبات مستنية" value={String(waiting.length)} icon={Hourglass} hint={`${money(waiting.reduce((s, r) => s + r.amount, 0))} ج.م`} />
      </div>

      <PettyRequests canAdd={canAdd} canEdit={canEdit} balance={balance} />

      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} allowAll />
        <SearchBox value={query} onChange={setQuery} placeholder="البيان، المستلم، اللي صرف أو الرقم" className="md:flex-1" />
      </FilterBar>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <TableCard minWidth={860}>
          <thead>
            <HeadRow>
              <Th>التاريخ</Th>
              <Th>الرقم</Th>
              <Th>البيان</Th>
              <Th>البند / القسم</Th>
              <Th>صرفه</Th>
              <Th num>المبلغ</Th>
              <Th className="w-12" />
            </HeadRow>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td num className="text-right">
                  {dateLabel(r.date)}
                </Td>
                <Td className="font-mono text-xs">
                  <span dir="ltr">{r.receiptId}</span>
                </Td>
                <Td>
                  <p>{r.description}</p>
                  {r.paidTo && <p className="text-[11px] text-muted-foreground">المستلم: {r.paidTo}</p>}
                </Td>
                <Td className="text-xs">
                  {r.category && <p className="mb-1 font-medium">{listLabel(db.lists.pettyCategories, r.category)}</p>}
                  <DeptBadge id={r.department} />
                </Td>
                <Td className="text-xs">{r.by ?? "—"}</Td>
                <Td num className="font-semibold text-expense">
                  {money(r.amount)}
                </Td>
                <Td>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="حذف"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (!window.confirm(`حذف ${r.receiptId}؟ المبلغ هيرجع للخزينة الرئيسية.`)) return;
                        if (deletePettyExpense(r.id)) toast.success("تم الحذف.");
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
            {!rows.length && <EmptyRow cols={7} text="لا توجد نثريات منصرفة في هذه الفترة." />}
            {rows.length > 0 && (
              <tr className="border-t-2 bg-muted/40 font-bold">
                <Td colSpan={5}>إجمالي منصرف الفترة ({rows.length} عملية)</Td>
                <Td num className="text-expense">{money(spent)}</Td>
                <Td />
              </tr>
            )}
          </tbody>
        </TableCard>

        <div className="grid h-fit gap-4">
          <TotalsCard title="المنصرف حسب البند" rows={byCat} />
          <TotalsCard title="المنصرف حسب القسم" rows={byDept} />
        </div>
      </div>

      <SpendDialog open={dialog} onOpenChange={setDialog} balance={balance} direct={direct} />

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        title="دفتر النثريات المنصرفة من الخزينة الرئيسية"
        subtitle={period === "all" ? "كل الفترات" : `شهر ${monthLabel(period)}`}
        issuedOn={dateLabel(isoDate(new Date()))}
      >
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>التاريخ</th>
              <th>الرقم</th>
              <th>البيان</th>
              <th>البند</th>
              <th>القسم</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.id} data-pdf-break>
                <td>{dateLabel(r.date)}</td>
                <td dir="ltr">{r.receiptId}</td>
                <td className="text-start">{r.description}</td>
                <td>{r.category ? listLabel(db.lists.pettyCategories, r.category) : "—"}</td>
                <td>{findDepartment(db.departments, r.department).name}</td>
                <td>{money(r.amount)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={5} className="text-start">
                الإجمالي ({rows.length} عملية)
              </td>
              <td>{money(spent)}</td>
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["أمين الخزينة", "المراجع الداخلي", "المدير المالي"]} />
      </OfficialDocument>
    </div>
  );
}

function TotalsCard({ title, rows }: { title: string; rows: { id: string; label: string; total: number; share: number }[] }) {
  return (
    <section className="ledger-card p-4">
      <h2 className="mb-3 font-bold">{title}</h2>
      {rows.length ? (
        <ul className="space-y-2 text-sm">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
              <span>{c.label}</span>
              <span className="num font-semibold">
                {money(c.total)} <span className="text-[11px] font-normal text-muted-foreground">({Math.round(c.share * 100)}٪)</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">لا يوجد منصرف.</p>
      )}
    </section>
  );
}

function PettyRequests({ canAdd, canEdit, balance }: { canAdd: boolean; canEdit: boolean; balance: number }) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  // Open requests first, then the latest decided ones.
  const rows = useMemo(() => {
    const open = db.pettyRequests.filter((r) => r.status === "pending" || r.status === "approved");
    const done = db.pettyRequests
      .filter((r) => r.status === "rejected" || r.status === "paid")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);
    return [...open.sort((a, b) => a.createdAt - b.createdAt), ...done];
  }, [db.pettyRequests]);
  if (!rows.length) return null;
  const waiting = rows.filter((r) => r.status === "pending").length;
  const ready = rows.filter((r) => r.status === "approved").length;
  return (
    <section className="ledger-card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/60 px-4 py-3">
        <h2 className="flex items-center gap-2 font-bold">
          <HandCoins className="size-4" /> طلبات صرف النثريات
        </h2>
        <p className="text-xs text-muted-foreground">
          {waiting} بانتظار اعتماد المدير المالي • {ready} معتمد بانتظار الصرف
        </p>
      </div>
      <ul>
        {rows.map((r) => {
          const mine = me?.id === r.requestedById;
          return (
            <li key={r.id} className="flex flex-col gap-2 border-b px-4 py-3 last:border-0 md:flex-row md:items-center">
              <span className="font-mono text-xs" dir="ltr">
                {r.number}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {r.description}
                  {r.paidTo ? ` — المستلم: ${r.paidTo}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {listLabel(db.lists.pettyCategories, r.category)} • طلبه {mine ? "أنت" : r.requestedBy} • {dateLabel(r.date)}
                  {r.decidedBy ? ` • ${r.status === "rejected" ? "رفضه" : "اعتمده"} ${r.decidedBy}` : ""}
                  {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                </p>
              </div>
              <span className="num font-semibold">{money(r.amount)} ج.م</span>
              <StatusBadge status={r.status} label={ORDER_STATUS_LABELS[r.status]} />
              <div className="flex gap-1">
                {canAdd && r.status === "approved" && (
                  <Button
                    size="sm"
                    disabled={r.amount > balance + 0.001}
                    title={r.amount > balance + 0.001 ? "رصيد الخزينة الرئيسية لا يكفي" : undefined}
                    onClick={() => {
                      if (!window.confirm(`صرف ${egp(r.amount)} من الخزينة الرئيسية؟`)) return;
                      if (payPettyRequest(r.id, isoDate(new Date()))) toast.success(`تم صرف ${egp(r.amount)}.`);
                    }}
                  >
                    <CheckCircle2 /> صرف
                  </Button>
                )}
                {canEdit && r.status !== "paid" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="حذف الطلب"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (!window.confirm(`حذف الطلب ${r.number}؟`)) return;
                      if (deletePettyRequest(r.id)) toast.success("تم حذف الطلب.");
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SpendDialog({
  open,
  onOpenChange,
  balance,
  direct,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  balance: number;
  direct: boolean;
}) {
  const db = useHospitalDB();
  const blank = () => ({
    date: isoDate(new Date()),
    department: GENERAL_DEPT_ID,
    category: db.lists.pettyCategories[0]?.id ?? "",
    description: "",
    paidTo: "",
    amount: "",
  });
  const [f, setF] = useState(blank);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setF(blank());
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(f.amount);
    if (!f.description.trim()) return setError("اكتب بيان المصروف.");
    if (!(amount > 0)) return setError("المبلغ يجب أن يكون أكبر من صفر.");
    if (direct) {
      if (addPettyExpense({ ...f, amount })) {
        toast.success(`تم صرف ${egp(amount)} نثريات من الخزينة الرئيسية.`);
        onOpenChange(false);
      }
    } else if (requestPetty({ ...f, amount })) {
      toast.success("تم إرسال الطلب — يُصرف بعد اعتماد المدير المالي.");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{direct ? "صرف نثرية" : "طلب صرف نثرية"}</DialogTitle>
          <DialogDescription>
            {direct
              ? `بتتصرف من الخزينة الرئيسية مباشرة — الرصيد المتاح: ${egp(balance)}`
              : `الطلب يُرسل للمدير المالي، ويُصرف من الخزينة الرئيسية بعد اعتماده. الرصيد الحالي: ${egp(balance)}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="pt-date">
              <Input id="pt-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            </FieldRow>
            <FieldRow label="البند">
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger aria-label="بند النثريات">
                  <SelectValue placeholder="اختر البند" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {db.lists.pettyCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          <FieldRow label="القسم">
            <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
          </FieldRow>
          <FieldRow label="البيان" htmlFor="pt-desc">
            <Input id="pt-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="مثال: شاي وسكر للاستقبال" />
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="المستلم (اختياري)" htmlFor="pt-to">
              <Input id="pt-to" value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} />
            </FieldRow>
            <FieldRow label="المبلغ (ج.م)" htmlFor="pt-amount">
              <Input id="pt-amount" type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </FieldRow>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">{direct ? "صرف" : "إرسال الطلب"}</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
