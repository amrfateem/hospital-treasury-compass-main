import { createFileRoute } from "@tanstack/react-router";
import { CalendarRange, CheckCircle2, FileDown, History, Plus, Save, Trash2, Undo2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, DocInfoGrid, FieldRow, HeadRow, TableCard, Td, Th, YEARS, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { useJournal } from "@/components/hospital/accounting/drill";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, egp, isoDate, money, monthName } from "@/lib/hospital/format";
import {
  BUDGET_LINE_KINDS,
  budgetTotals,
  cleanMonths,
  lineTotal,
  spreadYearly,
  variance,
  type BudgetLineKind,
  type FiscalBudget,
  type FiscalBudgetLine,
} from "@/lib/hospital/fiscal-budget";
import { accountName, incomeStatement, typeOf } from "@/lib/hospital/ledger";
import { canSpendDirectly } from "@/lib/hospital/permissions";
import { yearProfit } from "@/lib/hospital/profits";
import { approveFiscalBudget, deleteFiscalBudget, newId, saveFiscalBudget, useCan, useHospitalDB, useHospitalSession } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/fiscal-budget")({
  head: () => ({
    meta: [
      { title: "ميزانية السنة المالية | مستشفى الرحمة التخصصي" },
      { name: "description", content: "موازنة السنة المالية شهرًا بشهر: الإيرادات والمصروفات والأصول والتمويل، اعتمادها، ومقارنتها بالفعلي مع القوائم الختامية في ملف واحد." },
      { property: "og:title", content: "ميزانية السنة المالية | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "خطة السنة المالية ومقارنتها بالفعلي." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FiscalBudgetPage,
});

const KINDS = Object.keys(BUDGET_LINE_KINDS) as BudgetLineKind[];
const newLine = (kind: BudgetLineKind = "revenue"): FiscalBudgetLine => ({ id: newId(), kind, label: "", months: Array(12).fill(0) });
const emptyBudget = (year: number): FiscalBudget => ({ year, status: "draft", lines: [], openingCash: 0, updatedAt: 0 });

function FiscalBudgetPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canEdit = useCan("costCenters", "edit");
  const canApprove = !!me && canSpendDirectly(me);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const stored = db.fiscalBudgets.find((b) => b.year === year);
  const [draft, setDraft] = useState<FiscalBudget>(() => stored ?? emptyBudget(year));
  const [dirty, setDirty] = useState(false);
  const [monthsOf, setMonthsOf] = useState<FiscalBudgetLine | null>(null);
  const pdf = usePdfExport();

  useEffect(() => {
    setDraft(stored ? structuredClone(stored) : emptyBudget(year));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, stored?.updatedAt, stored?.status]);

  const { entries, accounts } = useJournal(`${year}-12-31`);
  const actual = useMemo(() => yearProfit(entries, year, typeOf), [entries, year]);
  const prevActual = useMemo(() => yearProfit(entries, year - 1, typeOf), [entries, year]);
  const statement = useMemo(() => incomeStatement(entries, `${year}-01-01`, `${year}-12-31`), [entries, year]);
  const t = budgetTotals(draft);
  const locked = draft.status === "approved";
  const editable = canEdit && !locked;
  const dept = (id?: string) => (id ? findDepartment(db.departments, id).name : "—");

  const patch = (p: Partial<FiscalBudget>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };
  const patchLine = (id: string, p: Partial<FiscalBudgetLine>) => patch({ lines: draft.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });

  function fillFromLastYear() {
    const lines: FiscalBudgetLine[] = [];
    for (const c of prevActual.byCenter) {
      const department = c.center === "general" ? undefined : c.center;
      const name = c.center === "general" ? "عام" : dept(c.center);
      if (c.revenue > 0) lines.push({ id: newId(), kind: "revenue", label: `إيرادات ${name}`, department, months: spreadYearly(c.revenue) });
      if (c.expense > 0) lines.push({ id: newId(), kind: "expense", label: `مصروفات ${name}`, department, months: spreadYearly(c.expense) });
    }
    if (!lines.length) {
      toast.error(`مفيش أرقام فعلية في ${year - 1} نبدأ منها.`);
      return;
    }
    patch({ lines: [...draft.lines, ...lines] });
    toast.success(`اتضاف ${lines.length} بند من فعلي ${year - 1} — عدّل الأرقام حسب خطة السنة.`);
  }
  function save() {
    if (saveFiscalBudget({ ...draft, lines: draft.lines.map((l) => ({ ...l, months: cleanMonths(l.months) })) })) {
      toast.success("اتحفظت الموازنة كمسودة.");
      setDirty(false);
    }
  }
  function approve(on: boolean) {
    if (dirty) {
      toast.error("احفظ التعديلات الأول.");
      return;
    }
    if (approveFiscalBudget(year, on)) toast.success(on ? "اتعتمدت موازنة السنة." : "اتلغى الاعتماد — الموازنة رجعت مسودة.");
  }
  function remove() {
    if (!window.confirm(`حذف موازنة ${year}؟`)) return;
    if (deleteFiscalBudget(year)) toast.success("اتحذفت الموازنة.");
  }

  const monthRows = t.monthly.map((m, i) => ({
    ...m,
    actualRevenue: actual.monthly[i]!.revenue,
    actualExpense: actual.monthly[i]!.expense,
  }));
  const vRev = variance(t.revenue, actual.total.revenue);
  const vExp = variance(t.expense, actual.total.expense);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="التخطيط المالي"
        title="ميزانية السنة المالية"
        description="خطة السنة شهر بشهر: الإيرادات المتوقعة، المصروفات التشغيلية، شراء الأجهزة والأصول، والتمويل. تُحفظ مسودة ويعتمدها المدير المالي، وبعدها تتقارن بالفعلي تلقائيًا."
        actions={
          <>
            <select aria-label="السنة" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 rounded-md border border-input bg-card px-3 text-sm">
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {editable && (
              <Button onClick={save} disabled={!dirty}>
                <Save /> حفظ المسودة
              </Button>
            )}
            {canApprove && stored && (
              locked ? (
                <Button variant="outline" onClick={() => approve(false)}>
                  <Undo2 /> إلغاء الاعتماد
                </Button>
              ) : (
                <Button variant="outline" onClick={() => approve(true)}>
                  <CheckCircle2 /> اعتماد الموازنة
                </Button>
              )
            )}
            <Button variant="outline" onClick={() => pdf.run(`موازنة-السنة-المالية-${year}.pdf`, "اتصدّرت الموازنة والقوائم الختامية.")} disabled={pdf.busy}>
              <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "الموازنة + القوائم الختامية PDF"}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", locked ? "bg-income/15 text-income" : "bg-copper/15 text-copper")}>
          {locked ? `معتمدة — ${draft.approvedBy ?? ""}` : stored ? "مسودة" : "لسه متعملتش"}
        </span>
        {draft.preparedBy && <span className="text-xs text-muted-foreground">أعدّها: {draft.preparedBy}</span>}
        {dirty && <span className="text-xs font-semibold text-destructive">في تعديلات مش محفوظة</span>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="الإيرادات المخططة" value={money(t.revenue)} hint={`الفعلي ${money(actual.total.revenue)}${vRev.pct !== null ? ` (${vRev.pct}٪)` : ""}`} tone="income" />
        <StatCard label="المصروفات المخططة" value={money(t.expense)} hint={`الفعلي ${money(actual.total.expense)}${vExp.pct !== null ? ` (${vExp.pct}٪)` : ""}`} tone="expense" />
        <StatCard label="الفائض التشغيلي المخطط" value={money(t.operatingSurplus)} hint={`الفعلي ${money(actual.total.net)}`} icon={CalendarRange} tone="primary" />
        <StatCard label="أصول وأجهزة + تمويل" value={money(t.capex)} hint={`تمويل ${money(t.financing)}`} tone="copper" />
        <StatCard label="النقدية المتوقعة آخر السنة" value={money(t.closingCash)} hint={`أول السنة ${money(draft.openingCash)}`} icon={Wallet} />
      </div>

      <section className="mb-6 grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-bold">بنود الموازنة</h2>
          <div className="flex flex-wrap items-end gap-2">
            <FieldRow label="النقدية أول السنة" htmlFor="fb-open">
              <Input id="fb-open" type="number" min={0} className="w-40" disabled={!editable} value={draft.openingCash || ""} onChange={(e) => patch({ openingCash: Number(e.target.value) || 0 })} />
            </FieldRow>
            {editable && (
              <>
                <Button variant="outline" onClick={fillFromLastYear}>
                  <History /> ابدأ من فعلي {year - 1}
                </Button>
                <Button variant="outline" onClick={() => patch({ lines: [...draft.lines, newLine()] })}>
                  <Plus /> بند
                </Button>
              </>
            )}
          </div>
        </div>
        <TableCard minWidth={980}>
          <thead>
            <HeadRow>
              <Th>النوع</Th>
              <Th>البند</Th>
              <Th>القسم</Th>
              <Th num>إجمالي السنة</Th>
              <Th num>متوسط الشهر</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {draft.lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <Td className="w-56">
                  <select aria-label="نوع البند" disabled={!editable} value={l.kind} onChange={(e) => patchLine(l.id, { kind: e.target.value as BudgetLineKind })} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm">
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{BUDGET_LINE_KINDS[k]}</option>
                    ))}
                  </select>
                </Td>
                <Td>
                  <Input aria-label="اسم البند" disabled={!editable} value={l.label} onChange={(e) => patchLine(l.id, { label: e.target.value })} placeholder="مثال: إيرادات المعمل" />
                </Td>
                <Td className="w-52">
                  {editable ? (
                    <DeptSelect value={l.department ?? "all"} onChange={(v) => patchLine(l.id, { department: v === "all" ? undefined : v })} allowAll allLabel="عام (كل المستشفى)" />
                  ) : (
                    dept(l.department)
                  )}
                </Td>
                <Td num className="w-40">
                  <Input
                    aria-label="إجمالي السنة"
                    type="number"
                    min={0}
                    disabled={!editable}
                    value={lineTotal(l) || ""}
                    onChange={(e) => patchLine(l.id, { months: spreadYearly(Number(e.target.value) || 0) })}
                  />
                </Td>
                <Td num>{money(lineTotal(l) / 12)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setMonthsOf(structuredClone(l))}>شهري</Button>
                    {editable && (
                      <Button size="icon" variant="ghost" aria-label="حذف البند" onClick={() => patch({ lines: draft.lines.filter((x) => x.id !== l.id) })}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {!draft.lines.length && (
              <tr>
                <td colSpan={6} className="px-3 py-14 text-center text-muted-foreground">
                  مفيش بنود. ابدأ من فعلي السنة اللي فاتت أو أضف بند.
                </td>
              </tr>
            )}
          </tbody>
        </TableCard>
        <FieldRow label="ملاحظات الموازنة" htmlFor="fb-notes">
          <Textarea id="fb-notes" rows={2} disabled={!editable} value={draft.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
        </FieldRow>
        {editable && stored && (
          <Button variant="ghost" className="justify-self-start text-destructive" onClick={remove}>
            <Trash2 /> حذف موازنة السنة
          </Button>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="font-bold">الخطة مقابل الفعلي شهر بشهر</h2>
        <TableCard minWidth={1000}>
          <thead>
            <HeadRow>
              <Th>الشهر</Th>
              <Th num>إيرادات مخططة</Th>
              <Th num>إيرادات فعلية</Th>
              <Th num>مصروفات مخططة</Th>
              <Th num>مصروفات فعلية</Th>
              <Th num>أصول</Th>
              <Th num>تمويل</Th>
              <Th num>صافي التدفق المخطط</Th>
              <Th num>النقدية المتوقعة</Th>
            </HeadRow>
          </thead>
          <tbody>
            {monthRows.map((m) => (
              <tr key={m.month} className="border-b last:border-0 hover:bg-muted/30">
                <Td>{monthName(m.month)}</Td>
                <Td num>{money(m.revenue)}</Td>
                <Td num className={cn(m.actualRevenue < m.revenue && m.revenue > 0 && "text-destructive")}>{money(m.actualRevenue)}</Td>
                <Td num>{money(m.expense)}</Td>
                <Td num className={cn(m.actualExpense > m.expense && m.expense > 0 && "text-destructive")}>{money(m.actualExpense)}</Td>
                <Td num>{money(m.capex)}</Td>
                <Td num>{money(m.financing)}</Td>
                <Td num className={cn("font-semibold", m.net < 0 && "text-destructive")}>{money(m.net)}</Td>
                <Td num>{money(m.cash)}</Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      </section>

      <Dialog open={!!monthsOf} onOpenChange={(o) => !o && setMonthsOf(null)}>
        <DialogContent dir="rtl" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>توزيع البند على الشهور</DialogTitle>
            <DialogDescription>{monthsOf?.label || "بند بدون اسم"} — {monthsOf ? BUDGET_LINE_KINDS[monthsOf.kind] : ""}</DialogDescription>
          </DialogHeader>
          {monthsOf && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {monthsOf.months.map((v, i) => (
                <FieldRow key={i} label={monthName(i + 1)} htmlFor={`m-${i}`}>
                  <Input
                    id={`m-${i}`}
                    type="number"
                    min={0}
                    disabled={!editable}
                    value={v || ""}
                    onChange={(e) => setMonthsOf({ ...monthsOf, months: monthsOf.months.map((x, k) => (k === i ? Number(e.target.value) || 0 : x)) })}
                  />
                </FieldRow>
              ))}
            </div>
          )}
          <p className="text-sm">الإجمالي: <b className="num">{egp(monthsOf ? lineTotal(monthsOf) : 0)}</b></p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMonthsOf(null)}>إغلاق</Button>
            {editable && (
              <Button
                onClick={() => {
                  if (monthsOf) patchLine(monthsOf.id, { months: cleanMonths(monthsOf.months) });
                  setMonthsOf(null);
                }}
              >
                تطبيق
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OfficialDocument ref={pdf.ref} settings={db.settings} title={`موازنة السنة المالية ${year} والقوائم الختامية`} subtitle={locked ? `معتمدة — ${draft.approvedBy ?? ""}` : "مسودة غير معتمدة"} issuedOn={dateLabel(isoDate(new Date()))} orientation="landscape">
        <DocInfoGrid
          items={[
            ["الإيرادات المخططة", egp(t.revenue)],
            ["الإيرادات الفعلية", egp(actual.total.revenue)],
            ["المصروفات المخططة", egp(t.expense)],
            ["المصروفات الفعلية", egp(actual.total.expense)],
            ["الفائض المخطط", egp(t.operatingSurplus)],
            ["صافي الربح الفعلي", egp(actual.total.net)],
            ["أصول وأجهزة مخططة", egp(t.capex)],
            ["النقدية المتوقعة آخر السنة", egp(t.closingCash)],
          ]}
        />
        <p data-pdf-break style={{ fontWeight: 700, margin: "10px 0 4px" }}>أولًا: بنود الموازنة</p>
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>النوع</th><th>البند</th><th>القسم</th><th>إجمالي السنة</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((l) => (
              <tr key={l.id} data-pdf-break>
                <td className="text-start">{BUDGET_LINE_KINDS[l.kind]}</td><td className="text-start">{l.label}</td><td>{dept(l.department)}</td><td>{money(lineTotal(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p data-pdf-break style={{ fontWeight: 700, margin: "14px 0 4px" }}>ثانيًا: الخطة مقابل الفعلي</p>
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>الشهر</th><th>إيراد مخطط</th><th>إيراد فعلي</th><th>مصروف مخطط</th><th>مصروف فعلي</th><th>أصول</th><th>تمويل</th><th>النقدية المتوقعة</th>
            </tr>
          </thead>
          <tbody>
            {monthRows.map((m) => (
              <tr key={m.month} data-pdf-break>
                <td className="text-start">{monthName(m.month)}</td><td>{money(m.revenue)}</td><td>{money(m.actualRevenue)}</td><td>{money(m.expense)}</td><td>{money(m.actualExpense)}</td><td>{money(m.capex)}</td><td>{money(m.financing)}</td><td>{money(m.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p data-pdf-break style={{ fontWeight: 700, margin: "14px 0 4px" }}>ثالثًا: قائمة الدخل الفعلية لسنة {year}</p>
        <table className="doc-table">
          <tbody>
            {statement.revenue.map((r) => (
              <tr key={r.account} data-pdf-break><td className="text-start">{accountName(accounts, r.account)}</td><td>{money(r.amount)}</td></tr>
            ))}
            <tr className="doc-total" data-pdf-break><td className="text-start">إجمالي الإيرادات</td><td>{money(statement.totalRevenue)}</td></tr>
            {statement.expenses.map((r) => (
              <tr key={r.account} data-pdf-break><td className="text-start">{accountName(accounts, r.account)}</td><td>({money(r.amount)})</td></tr>
            ))}
            <tr className="doc-total" data-pdf-break><td className="text-start">إجمالي المصروفات</td><td>({money(statement.totalExpenses)})</td></tr>
            <tr className="doc-total" data-pdf-break><td className="text-start">{statement.net >= 0 ? "صافي الربح" : "صافي الخسارة"}</td><td>{money(Math.abs(statement.net))}</td></tr>
          </tbody>
        </table>
        {draft.notes && <p data-pdf-break style={{ fontSize: 12, marginTop: 8 }}>ملاحظات: {draft.notes}</p>}
        <SignatureBlock roles={["المحاسب", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}
