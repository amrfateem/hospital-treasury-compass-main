import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, FileDown, Landmark, Scale, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, EmptyRow, FilterBar, HeadRow, matches, SearchBox, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { DrillAmount, DrillProvider, useDrill, useJournal } from "@/components/hospital/accounting/drill";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import {
  balanceSheet,
  dailyCashFlow,
  ENTRY_SOURCE_LABELS,
  GROUPS,
  groupOf,
  incomeStatement,
  trialBalance,
  type JournalEntry,
  type StatementRow,
} from "@/lib/hospital/ledger";
import { useHospitalDB } from "@/lib/hospital/store";
import { BranchSelect } from "@/components/hospital/BranchSelect";

export const Route = createFileRoute("/_authenticated/financial-reports")({
  head: () => ({
    meta: [
      { title: "القوائم المالية ودفتر الأستاذ | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "قائمة الدخل والميزانية العمومية وميزان المراجعة ودفتر اليومية والتدفق النقدي اليومي — لحظيًا مع الوصول لكل قيد.",
      },
      { property: "og:title", content: "القوائم المالية اللحظية | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تقارير مالية لحظية يمكن الضغط على أي رقم فيها للوصول للقيد الأصلي." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancialReportsPage,
});

type Tab = "income" | "balance" | "trial" | "journal" | "cash";

function FinancialReportsPage() {
  const db = useHospitalDB();
  const [range, setRange] = useState<Range>(thisMonth);
  const [tab, setTab] = useState<Tab>("income");
  const [center, setCenter] = useState("all");
  const [branch, setBranch] = useState("all");
  const { entries: allEntries } = useJournal(range.to);
  const { entries: branchEntries, name } = useJournal(range.to, branch);
  const entries = branch === "all" ? allEntries : branchEntries;
  const cc = center === "all" ? undefined : center;
  const income = useMemo(() => incomeStatement(entries, range.from, range.to, cc), [entries, range, cc]);
  // The balance sheet is always consolidated: cash moves between branches as transfers.
  const bs = useMemo(() => balanceSheet(allEntries, range.to), [allEntries, range.to]);
  const tb = useMemo(() => trialBalance(entries, range.from, range.to), [entries, range]);
  const cash = useMemo(() => dailyCashFlow(entries, range.from, range.to), [entries, range]);
  const pdf = usePdfExport();
  const tabTitle: Record<Tab, string> = {
    income: "قائمة الدخل (الأرباح والخسائر)",
    balance: "الميزانية العمومية (قائمة المركز المالي)",
    trial: "ميزان المراجعة",
    journal: "دفتر اليومية العامة",
    cash: "التدفق النقدي اليومي",
  };
  const scope = tab === "balance" ? `في ${dateLabel(range.to)}` : `من ${dateLabel(range.from)} إلى ${dateLabel(range.to)}${tab === "income" && cc ? ` — مركز تكلفة ${findDepartment(db.departments, cc).name}` : ""}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المحاسبة العامة"
        title="القوائم المالية ودفتر الأستاذ"
        description="كل إيصال وفاتورة ومصروف وتحويل يتحول تلقائيًا لقيد يومية مزدوج. الأرقام لحظية، واضغط على أي رقم للوصول للقيود والمستند الأصلي."
        actions={
          <Button variant="outline" disabled={pdf.busy} onClick={() => pdf.run(`${tabTitle[tab]}-${range.to}.pdf`, "تم تصدير التقرير.")}>
            <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "تصدير PDF"}
          </Button>
        }
      />
      <FilterBar>
        <RangePicker value={range} onChange={setRange} single={tab === "balance"} />
        {tab !== "balance" && <BranchSelect value={branch} onChange={setBranch} />}
        {tab === "income" && <DeptSelect value={center} onChange={setCenter} allowAll className="md:w-60" label="مركز التكلفة" />}
      </FilterBar>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="الإيرادات" value={money(income.totalRevenue)} icon={TrendingUp} tone="income" hint="ج.م" />
        <StatCard label="المصروفات" value={money(income.totalExpenses)} icon={TrendingDown} tone="expense" hint="ج.م" />
        <StatCard label="صافي الربح" value={money(income.net)} icon={Scale} tone={income.net >= 0 ? "primary" : "expense"} hint={income.totalRevenue ? `هامش ${money((income.net / income.totalRevenue) * 100)}%` : "ج.م"} />
        <StatCard label="النقدية والبنوك آخر المدة" value={money(cash.closing)} icon={Wallet} tone="copper" hint="ج.م" />
      </div>

      <DrillProvider entries={entries}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} dir="rtl">
          <TabsList className="mb-4 flex h-auto flex-wrap">
            <TabsTrigger value="income">قائمة الدخل</TabsTrigger>
            <TabsTrigger value="balance">الميزانية العمومية</TabsTrigger>
            <TabsTrigger value="trial">ميزان المراجعة</TabsTrigger>
            <TabsTrigger value="journal">دفتر اليومية</TabsTrigger>
            <TabsTrigger value="cash">التدفق النقدي اليومي</TabsTrigger>
          </TabsList>

          <TabsContent value="income">
            <TableCard minWidth={560}>
              <tbody>
                <StatementSection title="الإيرادات" rows={income.revenue} name={name} range={range} cc={cc} total={income.totalRevenue} />
                <StatementSection title="المصروفات" rows={income.expenses} name={name} range={range} cc={cc} total={income.totalExpenses} grouped />
                <tr className="border-t-2 bg-primary/5 text-base font-bold">
                  <Td>{income.net >= 0 ? "صافي الربح" : "صافي الخسارة"}</Td>
                  <Td num className={income.net >= 0 ? "text-primary" : "text-expense"}>{money(income.net)}</Td>
                </tr>
              </tbody>
            </TableCard>
          </TabsContent>

          <TabsContent value="balance">
            {!bs.balanced && (
              <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">الميزانية غير متوازنة — راجع القيود.</p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <TableCard minWidth={420}>
                <tbody>
                  <StatementSection title="الأصول" rows={bs.assets} name={name} range={{ from: "1900-01-01", to: range.to }} total={bs.totalAssets} />
                </tbody>
              </TableCard>
              <TableCard minWidth={420}>
                <tbody>
                  <StatementSection title="الالتزامات" rows={bs.liabilities} name={name} range={{ from: "1900-01-01", to: range.to }} total={bs.totalLiabilities} />
                  <StatementSection title="حقوق الملكية" rows={bs.equity} name={name} range={{ from: "1900-01-01", to: range.to }} total={bs.totalEquity} />
                  <tr className="border-t-2 bg-primary/5 font-bold">
                    <Td>إجمالي الالتزامات وحقوق الملكية</Td>
                    <Td num>{money(bs.totalLiabilities + bs.totalEquity)}</Td>
                  </tr>
                </tbody>
              </TableCard>
            </div>
          </TabsContent>

          <TabsContent value="trial">
            <TableCard minWidth={900}>
              <thead>
                <HeadRow>
                  <Th>الحساب</Th>
                  <Th num>رصيد أول مدين</Th>
                  <Th num>رصيد أول دائن</Th>
                  <Th num>حركة مدين</Th>
                  <Th num>حركة دائن</Th>
                  <Th num>رصيد آخر مدين</Th>
                  <Th num>رصيد آخر دائن</Th>
                </HeadRow>
              </thead>
              <tbody>
                {tb.map((r) => (
                  <tr key={r.account} className="border-b last:border-0 hover:bg-muted/40">
                    <Td>
                      <p className="font-semibold">{name(r.account)}</p>
                      <p dir="ltr" className="text-right font-mono text-[11px] text-muted-foreground">{r.account}</p>
                    </Td>
                    <Td num>{money(r.openingDebit)}</Td>
                    <Td num>{money(r.openingCredit)}</Td>
                    <Td num><DrillAmount value={r.debit} target={{ account: r.account, ...range }} /></Td>
                    <Td num><DrillAmount value={r.credit} target={{ account: r.account, ...range }} /></Td>
                    <Td num className="font-semibold">{money(r.closingDebit)}</Td>
                    <Td num className="font-semibold">{money(r.closingCredit)}</Td>
                  </tr>
                ))}
                {!tb.length && <EmptyRow cols={7} text="لا توجد قيود حتى هذا التاريخ." />}
                {!!tb.length && (
                  <tr className="statement-group">
                    <Td>الإجمالي</Td>
                    {(["openingDebit", "openingCredit", "debit", "credit", "closingDebit", "closingCredit"] as const).map((k) => (
                      <Td key={k} num>{money(tb.reduce((s, r) => s + r[k], 0))}</Td>
                    ))}
                  </tr>
                )}
              </tbody>
            </TableCard>
          </TabsContent>

          <TabsContent value="journal">
            <JournalList entries={entries} range={range} name={name} />
          </TabsContent>

          <TabsContent value="cash">
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="رصيد أول المدة" value={money(cash.opening)} icon={Landmark} />
              <StatCard label="المقبوضات" value={money(cash.inflow)} icon={TrendingUp} tone="income" />
              <StatCard label="المدفوعات" value={money(cash.outflow)} icon={TrendingDown} tone="expense" />
              <StatCard label="رصيد آخر المدة" value={money(cash.closing)} icon={Wallet} tone="primary" />
            </div>
            {!!cash.rows.length && (
              <div className="ledger-card mb-4 h-72 p-4" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cash.rows.map((r) => ({ ...r, day: r.date.slice(5) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} width={70} />
                    <Tooltip formatter={(v: number) => money(v)} />
                    <Legend />
                    <Bar dataKey="inflow" name="مقبوضات" fill="var(--color-income)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="outflow" name="مدفوعات" fill="var(--color-expense)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <TableCard minWidth={640}>
              <thead>
                <HeadRow>
                  <Th>اليوم</Th>
                  <Th num>المقبوضات</Th>
                  <Th num>المدفوعات</Th>
                  <Th num>صافي اليوم</Th>
                  <Th num>الرصيد</Th>
                </HeadRow>
              </thead>
              <tbody>
                {cash.rows.map((r) => (
                  <tr key={r.date} className="border-b last:border-0">
                    <Td num className="text-right">{dateLabel(r.date)}</Td>
                    <Td num className="text-income"><DrillAmount value={r.inflow} target={{ account: "1100", from: r.date, to: r.date, title: `حركة النقدية بالخزائن — ${dateLabel(r.date)}` }} /></Td>
                    <Td num className="text-expense">{money(r.outflow)}</Td>
                    <Td num className={r.net < 0 ? "text-expense" : ""}>{money(r.net)}</Td>
                    <Td num className="font-semibold">{money(r.balance)}</Td>
                  </tr>
                ))}
                {!cash.rows.length && <EmptyRow cols={5} text="لا توجد حركة نقدية في هذه الفترة." />}
              </tbody>
            </TableCard>
          </TabsContent>
        </Tabs>
      </DrillProvider>

      <OfficialDocument ref={pdf.ref} settings={db.settings} title={tabTitle[tab]} subtitle={scope} issuedOn={dateLabel(isoDate(new Date()))} orientation={tab === "trial" || tab === "journal" ? "landscape" : "portrait"}>
        {tab === "income" && (
          <DocStatement sections={[["الإيرادات", income.revenue, income.totalRevenue], ["المصروفات", income.expenses, income.totalExpenses]]} name={name} footer={[income.net >= 0 ? "صافي الربح" : "صافي الخسارة", income.net]} />
        )}
        {tab === "balance" && (
          <DocStatement sections={[["الأصول", bs.assets, bs.totalAssets], ["الالتزامات", bs.liabilities, bs.totalLiabilities], ["حقوق الملكية", bs.equity, bs.totalEquity]]} name={name} footer={["إجمالي الالتزامات وحقوق الملكية", bs.totalLiabilities + bs.totalEquity]} />
        )}
        {tab === "trial" && (
          <table className="doc-table">
            <thead>
              <tr data-pdf-break><th>الحساب</th><th>أول مدين</th><th>أول دائن</th><th>حركة مدين</th><th>حركة دائن</th><th>آخر مدين</th><th>آخر دائن</th></tr>
            </thead>
            <tbody>
              {tb.map((r) => (
                <tr key={r.account} data-pdf-break>
                  <td className="text-start">{name(r.account)}</td>
                  <td>{money(r.openingDebit)}</td><td>{money(r.openingCredit)}</td><td>{money(r.debit)}</td><td>{money(r.credit)}</td><td>{money(r.closingDebit)}</td><td>{money(r.closingCredit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "journal" && (
          <table className="doc-table">
            <thead><tr data-pdf-break><th>التاريخ</th><th>المستند</th><th>البيان</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
            <tbody>
              {entries.filter((e) => e.date >= range.from && e.date <= range.to).slice(0, 800).flatMap((e) =>
                e.lines.map((l, i) => (
                  <tr key={`${e.id}-${i}`} data-pdf-break>
                    <td>{i === 0 ? dateLabel(e.date) : ""}</td><td dir="ltr">{i === 0 ? e.number : ""}</td><td className="text-start">{i === 0 ? e.description : ""}</td>
                    <td className="text-start">{name(l.account)}</td><td>{l.debit ? money(l.debit) : ""}</td><td>{l.credit ? money(l.credit) : ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
        {tab === "cash" && (
          <table className="doc-table">
            <thead><tr data-pdf-break><th>اليوم</th><th>المقبوضات</th><th>المدفوعات</th><th>الصافي</th><th>الرصيد</th></tr></thead>
            <tbody>
              {cash.rows.map((r) => (
                <tr key={r.date} data-pdf-break><td>{dateLabel(r.date)}</td><td>{money(r.inflow)}</td><td>{money(r.outflow)}</td><td>{money(r.net)}</td><td>{money(r.balance)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <SignatureBlock roles={["المحاسب المختص", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}

function StatementSection({
  title,
  rows,
  name,
  range,
  cc,
  total,
  grouped,
}: {
  title: string;
  rows: StatementRow[];
  name: (c: string) => string;
  range: Range;
  cc?: string | undefined;
  total: number;
  grouped?: boolean;
}) {
  const groups = grouped ? [...new Set(rows.map((r) => groupOf(r.account)))] : [null];
  return (
    <>
      <tr className="statement-group">
        <Td colSpan={2}>{title}</Td>
      </tr>
      {groups.map((g) => {
        const list = g ? rows.filter((r) => groupOf(r.account) === g) : rows;
        const sub = list.reduce((s, r) => s + r.amount, 0);
        return (
          <GroupRows key={g ?? "all"} title={g && list.length > 1 ? GROUPS[g]?.name : undefined} groupCode={g} sub={sub} range={range} cc={cc}>
            {list.map((r) => (
              <tr key={r.account} className="border-b hover:bg-muted/40">
                <Td className={g && list.length > 1 ? "ps-8" : "ps-5"}>{name(r.account)}</Td>
                <Td num>
                  {r.account === "3200" ? (
                    <span title="أرباح الفترة حتى التاريخ — من قائمة الدخل">{money(r.amount)}</span>
                  ) : (
                    <DrillAmount value={r.amount} target={{ account: r.account, ...range, costCenter: cc }} />
                  )}
                </Td>
              </tr>
            ))}
          </GroupRows>
        );
      })}
      {!rows.length && (
        <tr>
          <Td colSpan={2} className="ps-5 text-muted-foreground">لا يوجد</Td>
        </tr>
      )}
      <tr className="border-b-2 font-bold">
        <Td>إجمالي {title}</Td>
        <Td num>{money(total)}</Td>
      </tr>
    </>
  );
}

function GroupRows({
  title,
  groupCode,
  sub,
  range,
  cc,
  children,
}: {
  title?: string | undefined;
  groupCode: string | null;
  sub: number;
  range: Range;
  cc?: string | undefined;
  children: ReactNode;
}) {
  if (!title || !groupCode) return <>{children}</>;
  return (
    <>
      <tr className="border-b bg-muted/30">
        <Td className="ps-5 font-semibold">{title}</Td>
        <Td num className="font-semibold">
          <DrillAmount value={sub} target={{ account: groupCode, ...range, costCenter: cc }} />
        </Td>
      </tr>
      {children}
    </>
  );
}

function JournalList({ entries, range, name }: { entries: JournalEntry[]; range: Range; name: (c: string) => string }) {
  const { openEntry } = useDrill();
  const [q, setQ] = useState("");
  const rows = entries
    .filter((e) => e.date >= range.from && e.date <= range.to && matches(q, e.number, e.description, ENTRY_SOURCE_LABELS[e.source]))
    .reverse();
  const shown = rows.slice(0, 300);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="بحث برقم المستند أو البيان" className="sm:w-72" />
        <p className="text-xs text-muted-foreground">{int(rows.length)} قيد{rows.length > shown.length ? ` — يظهر أحدث ${int(shown.length)}` : ""}</p>
      </div>
      <TableCard minWidth={820}>
        <thead>
          <HeadRow>
            <Th>التاريخ</Th>
            <Th>المستند</Th>
            <Th>البيان</Th>
            <Th>الحسابات</Th>
            <Th num>القيمة</Th>
          </HeadRow>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => openEntry(e)}>
              <Td num className="text-right">{dateLabel(e.date)}</Td>
              <Td className="font-mono text-xs">
                <span dir="ltr">{e.number}</span>
                <p className="font-sans text-[11px] text-muted-foreground">{ENTRY_SOURCE_LABELS[e.source]}</p>
              </Td>
              <Td className="max-w-72 truncate">{e.description}</Td>
              <Td className="text-xs text-muted-foreground">
                {e.lines.map((l) => `${l.debit ? "من" : "إلى"} ${name(l.account)}`).join(" • ")}
              </Td>
              <Td num className="font-semibold">{money(e.lines.reduce((s, l) => s + l.debit, 0))}</Td>
            </tr>
          ))}
          {!shown.length && <EmptyRow cols={5} text="لا توجد قيود في هذه الفترة." />}
        </tbody>
      </TableCard>
    </>
  );
}

function DocStatement({
  sections,
  name,
  footer,
}: {
  sections: [string, StatementRow[], number][];
  name: (c: string) => string;
  footer: [string, number];
}) {
  return (
    <table className="doc-table">
      <tbody>
        {sections.map(([title, rows, total]) => (
          <Fragment key={title}>
            <tr className="doc-total" data-pdf-break>
              <td className="text-start" colSpan={2}>{title}</td>
            </tr>
            {rows.map((r) => (
              <tr key={`${title}-${r.account}`} data-pdf-break>
                <td className="text-start">{name(r.account)}</td>
                <td>{money(r.amount)}</td>
              </tr>
            ))}
            <tr data-pdf-break>
              <td className="text-start"><b>إجمالي {title}</b></td>
              <td><b>{money(total)}</b></td>
            </tr>
          </Fragment>
        ))}
        <tr className="doc-total" data-pdf-break>
          <td className="text-start">{footer[0]}</td>
          <td>{money(footer[1])}</td>
        </tr>
      </tbody>
    </table>
  );
}
