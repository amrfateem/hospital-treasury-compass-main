import { createFileRoute } from "@tanstack/react-router";
import { FileDown, Gem, Pencil, Plus, TrendingDown, TrendingUp, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DocInfoGrid, FieldRow, HeadRow, TableCard, Td, Th, YEARS, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { useJournal } from "@/components/hospital/accounting/drill";
import { findDepartment } from "@/lib/hospital/constants";
import { dateLabel, egp, int, isoDate, money, monthName } from "@/lib/hospital/format";
import { typeOf } from "@/lib/hospital/ledger";
import { canSpendDirectly } from "@/lib/hospital/permissions";
import { DEFAULT_PROFIT_POLICY, distributeProfit, policyProblem, yearProfit, type ProfitPolicy } from "@/lib/hospital/profits";
import { saveProfitPolicy, useHospitalDB, useHospitalSession } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/profits")({
  head: () => ({
    meta: [
      { title: "إدارة أرباح المستشفى | مستشفى الرحمة التخصصي" },
      { name: "description", content: "صافي ربح المستشفى شهريًا ولكل قسم، وسياسة توزيع الأرباح (الضريبة والاحتياطي وأنصبة الشركاء) مع تصدير PDF." },
      { property: "og:title", content: "إدارة أرباح المستشفى | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "صافي الربح بالشهر والقسم وتوزيع الأرباح." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfitsPage,
});

const pct = (part: number, whole: number) => (whole ? `${money((part / whole) * 100)}٪` : "—");

function ProfitsPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [editing, setEditing] = useState<ProfitPolicy | null>(null);
  const pdf = usePdfExport();
  const { entries } = useJournal(`${year}-12-31`);
  const p = useMemo(() => yearProfit(entries, year, typeOf), [entries, year]);
  const policy = db.profitPolicies.find((x) => x.year === year) ?? DEFAULT_PROFIT_POLICY(year);
  const saved = db.profitPolicies.some((x) => x.year === year);
  const dist = distributeProfit(p.total.net, policy);
  const canPolicy = !!me && canSpendDirectly(me);
  const center = (id: string) => (id === "general" ? "عام (بدون قسم)" : findDepartment(db.departments, id).name);
  const best = p.byCenter[0];
  let running = 0;
  const cumulative = p.monthly.map((m) => (running = Math.round((running + m.net) * 100) / 100));

  function save() {
    if (!editing) return;
    const problem = policyProblem(editing);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (saveProfitPolicy(editing)) {
      toast.success("اتحفظت سياسة توزيع الأرباح.");
      setEditing(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="التقارير والأرباح"
        title="إدارة أرباح المستشفى"
        description="صافي الربح من القيود المحاسبية نفسها (يطابق قائمة الدخل): شهر بشهر ولكل قسم، ثم توزيعه حسب سياسة السنة — ضريبة الدخل، الاحتياطي، وأنصبة الشركاء."
        actions={
          <>
            <select
              aria-label="السنة"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {canPolicy && (
              <Button variant="outline" onClick={() => setEditing({ ...policy, partners: policy.partners.map((x) => ({ ...x })) })}>
                <Pencil /> سياسة التوزيع
              </Button>
            )}
            <Button onClick={() => pdf.run(`أرباح-المستشفى-${year}.pdf`, "اتصدّر تقرير الأرباح.")} disabled={pdf.busy}>
              <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "تصدير PDF"}
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`إيرادات ${year}`} value={money(p.total.revenue)} hint="ج.م" icon={TrendingUp} tone="income" />
        <StatCard label={`مصروفات ${year}`} value={money(p.total.expense)} hint="ج.م" icon={TrendingDown} tone="expense" />
        <StatCard
          label={p.total.net >= 0 ? "صافي الربح قبل الضريبة" : "صافي الخسارة"}
          value={money(Math.abs(p.total.net))}
          hint={`هامش ${pct(p.total.net, p.total.revenue)}`}
          icon={Gem}
          tone={p.total.net >= 0 ? "primary" : "expense"}
        />
        <StatCard label="الأكثر ربحًا" value={best && best.net > 0 ? center(best.center) : "—"} hint={best && best.net > 0 ? egp(best.net) : undefined} tone="copper" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="grid gap-2">
          <h2 className="font-bold">الربح شهر بشهر</h2>
          <TableCard minWidth={620}>
            <thead>
              <HeadRow>
                <Th>الشهر</Th>
                <Th num>الإيرادات</Th>
                <Th num>المصروفات</Th>
                <Th num>صافي الشهر</Th>
                <Th num>المتراكم</Th>
              </HeadRow>
            </thead>
            <tbody>
              {p.monthly.map((m, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  <Td>{monthName(i + 1)}</Td>
                  <Td num>{money(m.revenue)}</Td>
                  <Td num>{money(m.expense)}</Td>
                  <Td num className={cn("font-semibold", m.net < 0 ? "text-destructive" : m.net > 0 && "text-income")}>{money(m.net)}</Td>
                  <Td num className="text-muted-foreground">{money(cumulative[i]!)}</Td>
                </tr>
              ))}
              <tr className="bg-secondary/60 font-bold">
                <Td>الإجمالي</Td>
                <Td num>{money(p.total.revenue)}</Td>
                <Td num>{money(p.total.expense)}</Td>
                <Td num>{money(p.total.net)}</Td>
                <Td />
              </tr>
            </tbody>
          </TableCard>
        </section>

        <section className="grid content-start gap-2">
          <h2 className="font-bold">توزيع أرباح {year}</h2>
          <div className="ledger-card grid gap-2 p-4 text-sm">
            {!saved && <p className="rounded-md bg-copper/10 p-2 text-xs text-copper">السياسة دي افتراضية — احفظ سياسة السنة من زر «سياسة التوزيع».</p>}
            <Row label="صافي الربح قبل الضريبة" value={egp(dist.netBeforeTax)} strong />
            <Row label={`ضريبة الدخل ${money(policy.taxPct)}٪`} value={`(${egp(dist.tax)})`} />
            <Row label="صافي الربح بعد الضريبة" value={egp(dist.netAfterTax)} />
            <Row label={`الاحتياطي ${money(policy.reservePct)}٪`} value={`(${egp(dist.reserve)})`} />
            <Row label="الربح القابل للتوزيع" value={egp(dist.distributable)} strong />
            <div className="my-1 border-t" />
            {dist.partners.map((x) => (
              <Row key={x.name} label={`${x.name} — ${money(x.pct)}٪`} value={egp(x.amount)} />
            ))}
            {dist.retained > 0 && <Row label="أرباح محتجزة (غير موزعة)" value={egp(dist.retained)} />}
            {p.total.net <= 0 && <p className="text-xs text-muted-foreground">مفيش أرباح للتوزيع — الخسارة لا تُوزّع ولا تُحسب عليها ضريبة.</p>}
            {policy.notes && <p className="text-xs text-muted-foreground">ملاحظات: {policy.notes}</p>}
            {saved && policy.by && <p className="text-[11px] text-muted-foreground">آخر تعديل: {policy.by}</p>}
          </div>
        </section>
      </div>

      <section className="grid gap-2">
        <h2 className="font-bold">الربح حسب القسم</h2>
        <TableCard minWidth={700}>
          <thead>
            <HeadRow>
              <Th>القسم</Th>
              <Th num>الإيرادات</Th>
              <Th num>المصروفات المباشرة</Th>
              <Th num>صافي القسم</Th>
              <Th num>هامش الربح</Th>
              <Th num>من إجمالي الإيرادات</Th>
            </HeadRow>
          </thead>
          <tbody>
            {p.byCenter.map((c) => (
              <tr key={c.center} className="border-b last:border-0 hover:bg-muted/30">
                <Td className="font-semibold">{center(c.center)}</Td>
                <Td num>{money(c.revenue)}</Td>
                <Td num>{money(c.expense)}</Td>
                <Td num className={cn("font-bold", c.net < 0 ? "text-destructive" : "text-income")}>{money(c.net)}</Td>
                <Td num>{pct(c.net, c.revenue)}</Td>
                <Td num>{pct(c.revenue, p.total.revenue)}</Td>
              </tr>
            ))}
            {!p.byCenter.length && (
              <tr>
                <td colSpan={6} className="px-3 py-14 text-center text-muted-foreground">مفيش إيرادات أو مصروفات مسجلة في {year}.</td>
              </tr>
            )}
          </tbody>
        </TableCard>
      </section>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>سياسة توزيع أرباح {year}</DialogTitle>
            <DialogDescription>الضريبة تُحسب على صافي الربح، والاحتياطي على الربح بعد الضريبة، والباقي يتوزع بالنسب.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="ضريبة الدخل ٪" htmlFor="pp-tax">
                  <Input id="pp-tax" type="number" min={0} max={100} step="0.5" value={editing.taxPct} onChange={(e) => setEditing({ ...editing, taxPct: Number(e.target.value) })} />
                </FieldRow>
                <FieldRow label="الاحتياطي ٪" htmlFor="pp-res">
                  <Input id="pp-res" type="number" min={0} max={100} step="0.5" value={editing.reservePct} onChange={(e) => setEditing({ ...editing, reservePct: Number(e.target.value) })} />
                </FieldRow>
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-semibold">الشركاء وأنصبتهم</p>
                {editing.partners.map((x, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      aria-label={`اسم الشريك ${i + 1}`}
                      value={x.name}
                      onChange={(e) => setEditing({ ...editing, partners: editing.partners.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)) })}
                    />
                    <Input
                      aria-label={`نصيب الشريك ${i + 1}`}
                      type="number"
                      min={0}
                      max={100}
                      className="w-24"
                      value={x.pct}
                      onChange={(e) => setEditing({ ...editing, partners: editing.partners.map((y, k) => (k === i ? { ...y, pct: Number(e.target.value) } : y)) })}
                    />
                    <Button type="button" variant="ghost" size="icon" aria-label="حذف الشريك" disabled={editing.partners.length === 1} onClick={() => setEditing({ ...editing, partners: editing.partners.filter((_, k) => k !== i) })}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setEditing({ ...editing, partners: [...editing.partners, { name: "", pct: 0 }] })}>
                  <Plus /> شريك
                </Button>
                <p className="text-xs text-muted-foreground">
                  المجموع {money(editing.partners.reduce((s, x) => s + (Number(x.pct) || 0), 0))}٪ — أي نسبة أقل من 100٪ تفضل أرباح محتجزة.
                </p>
              </div>
              <FieldRow label="ملاحظات" htmlFor="pp-notes">
                <Textarea id="pp-notes" rows={2} value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </FieldRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button onClick={save}>حفظ السياسة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OfficialDocument ref={pdf.ref} settings={db.settings} title={`تقرير أرباح المستشفى لسنة ${year}`} subtitle="صافي الربح بالشهر والقسم وتوزيع الأرباح" issuedOn={dateLabel(isoDate(new Date()))}>
        <DocInfoGrid
          items={[
            ["إجمالي الإيرادات", egp(p.total.revenue)],
            ["إجمالي المصروفات", egp(p.total.expense)],
            [p.total.net >= 0 ? "صافي الربح" : "صافي الخسارة", egp(Math.abs(p.total.net))],
            ["هامش الربح", pct(p.total.net, p.total.revenue)],
          ]}
        />
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>الشهر</th><th>الإيرادات</th><th>المصروفات</th><th>صافي الشهر</th><th>المتراكم</th>
            </tr>
          </thead>
          <tbody>
            {p.monthly.map((m, i) => (
              <tr key={i} data-pdf-break>
                <td className="text-start">{monthName(i + 1)}</td>
                <td>{money(m.revenue)}</td><td>{money(m.expense)}</td><td>{money(m.net)}</td><td>{money(cumulative[i]!)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td className="text-start">الإجمالي</td><td>{money(p.total.revenue)}</td><td>{money(p.total.expense)}</td><td>{money(p.total.net)}</td><td />
            </tr>
          </tbody>
        </table>
        <table className="doc-table" style={{ marginTop: 14 }}>
          <thead>
            <tr data-pdf-break>
              <th>القسم</th><th>الإيرادات</th><th>المصروفات</th><th>الصافي</th><th>الهامش</th>
            </tr>
          </thead>
          <tbody>
            {p.byCenter.map((c) => (
              <tr key={c.center} data-pdf-break>
                <td className="text-start">{center(c.center)}</td><td>{money(c.revenue)}</td><td>{money(c.expense)}</td><td>{money(c.net)}</td><td>{pct(c.net, c.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="doc-table" style={{ marginTop: 14 }}>
          <tbody>
            <tr data-pdf-break><td className="text-start">صافي الربح قبل الضريبة</td><td>{money(dist.netBeforeTax)}</td></tr>
            <tr data-pdf-break><td className="text-start">ضريبة الدخل {money(policy.taxPct)}٪</td><td>({money(dist.tax)})</td></tr>
            <tr data-pdf-break><td className="text-start">الاحتياطي {money(policy.reservePct)}٪</td><td>({money(dist.reserve)})</td></tr>
            <tr className="doc-total" data-pdf-break><td className="text-start">القابل للتوزيع</td><td>{money(dist.distributable)}</td></tr>
            {dist.partners.map((x) => (
              <tr key={x.name} data-pdf-break><td className="text-start">{x.name} ({money(x.pct)}٪)</td><td>{money(x.amount)}</td></tr>
            ))}
            {dist.retained > 0 && <tr data-pdf-break><td className="text-start">أرباح محتجزة</td><td>{money(dist.retained)}</td></tr>}
          </tbody>
        </table>
        <p data-pdf-break style={{ fontSize: 11.5, marginTop: 8 }}>عدد الأقسام: {int(p.byCenter.length)} — الأرقام من القيود المحاسبية وتطابق قائمة الدخل.</p>
        <SignatureBlock roles={["المحاسب", "المدير المالي", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong && "font-bold")}>
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
