import { createFileRoute, Link } from "@tanstack/react-router";
import { FileDown, Layers, Plus, Receipt, Trash2, TrendingDown } from "lucide-react";
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
  DeptSelect,
  DocInfoGrid,
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
import { findDepartment, GENERAL_DEPT_ID } from "@/lib/hospital/constants";
import { expenseCategory, expenseEntries, groupTotals } from "@/lib/hospital/expenses";
import { dateLabel, egp, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  addExpense,
  deleteExpense,
  findBox,
  MAIN_BOX_ID,
  TX_SOURCE_LABELS,
  canSpendDirectly,
  useCan,
  useHospitalSession,
  useHospitalDB,
} from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({
    meta: [
      { title: "إدارة المصروفات | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "سجل موحد لكل مصروفات المستشفى: كل مبلغ يخرج من أي خزينة يُسجَّل تلقائيًا كمصروف.",
      },
      { property: "og:title", content: "إدارة المصروفات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "كل ما يخرج من الخزائن مصنفًا حسب البند والقسم." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const db = useHospitalDB();
  const canEdit = useCan("expenses");
  const { me } = useHospitalSession();
  const canAdd = useCan("expenses", "add") && !!me && canSpendDirectly(me);
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [dept, setDept] = useState("all");
  const [cat, setCat] = useState("all");
  const [box, setBox] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const pdf = usePdfExport();

  const all = useMemo(
    () =>
      expenseEntries(db.transactions).map((t) => ({
        ...t,
        cat: expenseCategory(t, db.lists),
      })),
    [db.transactions, db.lists],
  );
  const inPeriod = useMemo(
    () => all.filter((t) => period === "all" || t.date.startsWith(period)),
    [all, period],
  );
  const categories = useMemo(() => groupTotals(inPeriod, (t) => t.cat), [inPeriod]);
  const rows = useMemo(
    () =>
      inPeriod
        .filter(
          (t) =>
            (dept === "all" || t.department === dept) &&
            (cat === "all" || t.cat.id === cat) &&
            (box === "all" || (t.boxId ?? MAIN_BOX_ID) === box) &&
            matches(query, t.description, t.receiptId, t.paidTo, t.cat.label),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [inPeriod, dept, cat, box, query],
  );
  const total = rows.reduce((s, t) => s + t.amount, 0);
  const byCat = useMemo(() => groupTotals(rows, (t) => t.cat), [rows]);
  const byDept = useMemo(
    () =>
      groupTotals(rows, (t) => ({
        id: t.department,
        label: findDepartment(db.departments, t.department).name,
      })),
    [rows, db.departments],
  );
  const scope = period === "all" ? "كل الفترات" : `شهر ${monthLabel(period)}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المصروفات"
        title="إدارة المصروفات"
        description="كل مبلغ يخرج من أي خزينة — رواتب، موردين، أطباء، نثريات، أوامر صرف، عجز ورديات — يُسجَّل هنا تلقائيًا كمصروف ومصنّف على البند والقسم."
        actions={
          <>
            {canAdd ? (
              <Button onClick={() => setOpen(true)}>
                <Plus /> تسجيل مصروف
              </Button>
            ) : (
              <Button variant="secondary" asChild>
                <Link to="/orders">
                  <Plus /> طلب أمر صرف (يعتمده المدير المالي)
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pdf.busy}
              onClick={() => pdf.run(`سجل-المصروفات-${period}.pdf`, "تم تصدير سجل المصروفات.")}
            >
              <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "تصدير PDF"}
            </Button>
          </>
        }
      />

      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} allowAll />
        <DeptSelect value={dept} onChange={setDept} allowAll className="md:w-56" />
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="bg-card md:w-60" aria-label="بند المصروف">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل البنود</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <BoxSelect value={box} onChange={setBox} allowAll className="md:w-52" />
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="البيان، المستفيد أو رقم الإيصال"
          className="md:flex-1"
        />
      </FilterBar>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="إجمالي المصروفات" value={money(total)} icon={TrendingDown} tone="expense" hint="ج.م" />
        <StatCard label="عدد حركات الصرف" value={int(rows.length)} icon={Receipt} />
        <StatCard
          label="أكبر بند"
          value={<span className="text-base">{byCat[0]?.label ?? "—"}</span>}
          hint={byCat[0] ? egp(byCat[0].total) : undefined}
          icon={Layers}
          tone="copper"
        />
        <StatCard
          label="أعلى قسم صرفًا"
          value={<span className="text-base">{byDept[0]?.label ?? "—"}</span>}
          hint={byDept[0] ? egp(byDept[0].total) : undefined}
          icon={Layers}
          tone="primary"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Breakdown title="حسب بند المصروف" groups={byCat} />
        <Breakdown title="حسب القسم" groups={byDept} />
      </div>

      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>التاريخ</Th>
            <Th>رقم الإيصال</Th>
            <Th>البند</Th>
            <Th>القسم</Th>
            <Th>البيان</Th>
            <Th>الخزينة</Th>
            <Th num>المبلغ</Th>
            <Th className="w-28" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td num className="text-right">
                {dateLabel(t.date)}
              </Td>
              <Td className="font-mono text-xs">
                <span dir="ltr">{t.receiptId}</span>
              </Td>
              <Td className="text-xs font-medium">{t.cat.label}</Td>
              <Td>
                <DeptBadge id={t.department} />
              </Td>
              <Td>
                <p>{t.description}</p>
                {t.paidTo && <p className="text-[11px] text-muted-foreground">المستفيد: {t.paidTo}</p>}
              </Td>
              <Td className="text-xs">{findBox(db, t.boxId).name}</Td>
              <Td num className="font-semibold text-expense">
                {money(t.amount)}
              </Td>
              <Td>
                {t.source === "expense" && canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="حذف المصروف"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (window.confirm(`حذف المصروف ${t.receiptId}؟`) && deleteExpense(t.id))
                        toast.success("تم حذف المصروف.");
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : (
                  <span className="block text-left text-[10px] text-muted-foreground">
                    من {TX_SOURCE_LABELS[t.source]}
                  </span>
                )}
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={8} text="لا توجد مصروفات في هذه الفترة." />}
        </tbody>
      </TableCard>

      <ExpenseDialog open={open} onOpenChange={setOpen} />

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        title="سجل المصروفات"
        subtitle={scope}
        issuedOn={dateLabel(isoDate(new Date()))}
        orientation="landscape"
      >
        <DocInfoGrid
          items={[
            ["إجمالي المصروفات", egp(total)],
            ["عدد الحركات", int(rows.length)],
          ]}
        />
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>التاريخ</th>
              <th>رقم الإيصال</th>
              <th>البند</th>
              <th>القسم</th>
              <th>البيان</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} data-pdf-break>
                <td>{dateLabel(t.date)}</td>
                <td dir="ltr">{t.receiptId}</td>
                <td>{t.cat.label}</td>
                <td>{findDepartment(db.departments, t.department).name}</td>
                <td className="text-start">{t.description}</td>
                <td>{money(t.amount)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={5} className="text-start">
                الإجمالي
              </td>
              <td>{money(total)}</td>
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["المحاسب المختص", "المراجع الداخلي", "المدير المالي"]} />
      </OfficialDocument>
    </div>
  );
}

function Breakdown({
  title,
  groups,
}: {
  title: string;
  groups: { id: string; label: string; total: number; share: number; count: number }[];
}) {
  return (
    <section className="ledger-card p-4">
      <h2 className="mb-3 font-bold">{title}</h2>
      {groups.length ? (
        <ul className="space-y-2.5">
          {groups.slice(0, 8).map((g) => (
            <li key={g.id}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{g.label}</span>
                <span className="num shrink-0 font-semibold">{money(g.total)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-expense"
                  style={{ width: `${Math.max(2, Math.round(g.share * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">لا توجد بيانات.</p>
      )}
    </section>
  );
}

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useHospitalDB();
  const [f, setF] = useState({
    date: isoDate(new Date()),
    department: GENERAL_DEPT_ID,
    category: "",
    description: "",
    paidTo: "",
    amount: "",
    boxId: MAIN_BOX_ID,
    method: "cash",
  });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setError("");
    setF({
      date: isoDate(new Date()),
      department: GENERAL_DEPT_ID,
      category: (db.lists.expenseCategories.find((c) => c.id === "operational") ?? db.lists.expenseCategories[0])?.id ?? "",
      description: "",
      paidTo: "",
      amount: "",
      boxId: MAIN_BOX_ID,
      method: "cash",
    });
  }, [open, db.lists.expenseCategories]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(f.amount);
    if (!f.description.trim()) return setError("اكتب بيان المصروف.");
    if (!(amount > 0)) return setError("المبلغ يجب أن يكون أكبر من صفر.");
    if (addExpense({ ...f, amount })) {
      toast.success(`تم تسجيل مصروف بقيمة ${egp(amount)}.`);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">تسجيل مصروف</DialogTitle>
          <DialogDescription>يُخصم من الخزينة المختارة ويظهر في سجل المصروفات والخزينة.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="ex-date">
              <Input id="ex-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            </FieldRow>
            <FieldRow label="القسم">
              <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
            </FieldRow>
          </div>
          <FieldRow label="بند المصروف">
            <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
              <SelectTrigger aria-label="بند المصروف">
                <SelectValue placeholder="اختر البند" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {db.lists.expenseCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="البيان" htmlFor="ex-desc">
            <Input id="ex-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="مثال: فاتورة كهرباء شهر نوفمبر" />
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="المستفيد (اختياري)" htmlFor="ex-to">
              <Input id="ex-to" value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} />
            </FieldRow>
            <FieldRow label="المبلغ (ج.م)" htmlFor="ex-amount">
              <Input id="ex-amount" type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </FieldRow>
            <FieldRow label="من خزينة">
              <BoxSelect value={f.boxId} onChange={(v) => setF({ ...f, boxId: v })} />
            </FieldRow>
            <FieldRow label="طريقة الدفع">
              <MethodSelect value={f.method} onChange={(v) => setF({ ...f, method: v })} />
            </FieldRow>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ المصروف</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
