/**
 * Shared shell of the detailed report managements (revenue / payments / petty cash): tabs of
 * grouped tables and document-by-document detail, with Excel and PDF of the tab on screen.
 */
import { FileDown, FileSpreadsheet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/hospital/ui";
import { EmptyRow, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { downloadCsv } from "@/lib/hospital/csv";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import type { ReportGroup } from "@/lib/hospital/reports";
import { useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export interface Column<T> {
  label: string;
  get: (row: T) => string | number;
  /** Money column (formatted, summed in the total row). */
  money?: boolean;
  wide?: boolean;
}

export type ReportView =
  | { key: string; title: string; kind: "group"; rows: ReportGroup[]; first: string; qty?: string; amount?: string; dates?: boolean }
  | { key: string; title: string; kind: "detail"; rows: unknown[]; columns: Column<never>[] };

export function groupView(key: string, title: string, rows: ReportGroup[], first: string, extra: { qty?: string; amount?: string; dates?: boolean } = {}): ReportView {
  return { key, title, kind: "group", rows, first, ...extra };
}
export function detailView<T>(key: string, title: string, rows: T[], columns: Column<T>[]): ReportView {
  return { key, title, kind: "detail", rows, columns: columns as Column<never>[] };
}

const cellText = (c: Column<never>, row: unknown) => {
  const v = c.get(row as never);
  return c.money ? money(Number(v)) : String(v ?? "");
};

const groupLabel = (v: Extract<ReportView, { kind: "group" }>, g: ReportGroup) =>
  v.dates ? (g.key.length === 7 ? g.key : dateLabel(g.key)) : g.label;

function GroupTable({ view }: { view: Extract<ReportView, { kind: "group" }> }) {
  const total = view.rows.reduce((s, g) => s + g.total, 0);
  return (
    <TableCard minWidth={620}>
      <thead>
        <HeadRow>
          <Th>{view.first}</Th>
          <Th num>العدد</Th>
          {view.qty && <Th num>{view.qty}</Th>}
          <Th num>{view.amount ?? "المبلغ"}</Th>
          <Th className="w-56">النسبة</Th>
        </HeadRow>
      </thead>
      <tbody>
        {view.rows.map((g) => (
          <tr key={g.key} className="border-b last:border-0 hover:bg-muted/30">
            <Td className="font-medium">{groupLabel(view, g)}</Td>
            <Td num>{int(g.count)}</Td>
            {view.qty && <Td num>{int(g.qty)}</Td>}
            <Td num className="font-semibold">{money(g.total)}</Td>
            <Td>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, g.share * 100))}%` }} />
                </div>
                <span className="num w-10 text-left text-xs text-muted-foreground">{Math.round(g.share * 100)}٪</span>
              </div>
            </Td>
          </tr>
        ))}
        {!view.rows.length && <EmptyRow cols={view.qty ? 5 : 4} text="مفيش حركة في الفترة دي." />}
        {!!view.rows.length && (
          <tr className="bg-muted/40 font-bold">
            <Td>الإجمالي</Td>
            <Td num>{int(view.rows.reduce((s, g) => s + g.count, 0))}</Td>
            {view.qty && <Td num>{int(view.rows.reduce((s, g) => s + g.qty, 0))}</Td>}
            <Td num>{money(total)}</Td>
            <Td />
          </tr>
        )}
      </tbody>
    </TableCard>
  );
}

const PAGE = 300;
function DetailTable({ view }: { view: Extract<ReportView, { kind: "detail" }> }) {
  const [limit, setLimit] = useState(PAGE);
  const shown = view.rows.slice(0, limit);
  return (
    <div className="grid gap-2">
      <TableCard minWidth={Math.max(900, view.columns.length * 110)}>
        <thead>
          <HeadRow>
            {view.columns.map((c) => (
              <Th key={c.label} num={!!c.money}>{c.label}</Th>
            ))}
          </HeadRow>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
              {view.columns.map((c) => (
                <Td key={c.label} num={!!c.money} className={cn(c.wide ? "min-w-56" : "whitespace-nowrap", c.money && "font-semibold")}>
                  {cellText(c, row)}
                </Td>
              ))}
            </tr>
          ))}
          {!view.rows.length && <EmptyRow cols={view.columns.length} text="مفيش مستندات في الفترة دي." />}
          {!!view.rows.length && (
            <tr className="bg-muted/40 font-bold">
              {view.columns.map((c, i) => (
                <Td key={c.label} num={!!c.money}>
                  {i === 0 ? `الإجمالي (${int(view.rows.length)})` : c.money ? money(view.rows.reduce((s: number, r) => s + Number(c.get(r as never)), 0)) : ""}
                </Td>
              ))}
            </tr>
          )}
        </tbody>
      </TableCard>
      {view.rows.length > limit && (
        <Button variant="outline" className="justify-self-center" onClick={() => setLimit((l) => l + PAGE)}>
          عرض المزيد ({int(view.rows.length - limit)} مستند متبقي)
        </Button>
      )}
    </div>
  );
}

function DocView({ view }: { view: ReportView }) {
  if (view.kind === "group") {
    const total = view.rows.reduce((s, g) => s + g.total, 0);
    return (
      <table className="doc-table" style={{ marginBottom: 14 }}>
        <thead>
          <tr data-pdf-break>
            <th>{view.first}</th>
            <th>العدد</th>
            {view.qty && <th>{view.qty}</th>}
            <th>{view.amount ?? "المبلغ"}</th>
            <th>النسبة</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((g) => (
            <tr key={g.key} data-pdf-break>
              <td className="text-start">{groupLabel(view, g)}</td>
              <td>{int(g.count)}</td>
              {view.qty && <td>{int(g.qty)}</td>}
              <td>{money(g.total)}</td>
              <td>{Math.round(g.share * 100)}٪</td>
            </tr>
          ))}
          <tr className="doc-total" data-pdf-break>
            <td className="text-start">الإجمالي</td>
            <td>{int(view.rows.reduce((s, g) => s + g.count, 0))}</td>
            {view.qty && <td>{int(view.rows.reduce((s, g) => s + g.qty, 0))}</td>}
            <td>{money(total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    );
  }
  return (
    <table className="doc-table">
      <thead>
        <tr data-pdf-break>
          {view.columns.map((c) => (
            <th key={c.label}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row, i) => (
          <tr key={i} data-pdf-break>
            {view.columns.map((c) => (
              <td key={c.label} className={c.wide ? "text-start" : undefined}>{cellText(c, row)}</td>
            ))}
          </tr>
        ))}
        <tr className="doc-total" data-pdf-break>
          {view.columns.map((c, i) => (
            <td key={c.label}>
              {i === 0 ? `الإجمالي (${int(view.rows.length)})` : c.money ? money(view.rows.reduce((s: number, r) => s + Number(c.get(r as never)), 0)) : ""}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function csvOf(view: ReportView): [string[], unknown[][]] {
  if (view.kind === "group")
    return [
      [view.first, "العدد", ...(view.qty ? [view.qty] : []), view.amount ?? "المبلغ", "النسبة %"],
      view.rows.map((g) => [groupLabel(view, g), g.count, ...(view.qty ? [g.qty] : []), g.total, Math.round(g.share * 1000) / 10]),
    ];
  return [view.columns.map((c) => c.label), view.rows.map((r) => view.columns.map((c) => c.get(r as never)))];
}

export function ReportShell({
  eyebrow,
  title,
  description,
  fileBase,
  from,
  to,
  filters,
  summary,
  summaryFacts,
  views,
  signatures = ["المحاسب المختص", "المراجع الداخلي", "المدير المالي"],
}: {
  eyebrow: string;
  title: string;
  description: string;
  fileBase: string;
  from: string;
  to: string;
  filters: ReactNode;
  /** On-screen summary tab. */
  summary: ReactNode;
  /** Key figures printed on the summary PDF. */
  summaryFacts: [string, string][];
  views: ReportView[];
  signatures?: string[];
}) {
  const db = useHospitalDB();
  const [tab, setTab] = useState("summary");
  const pdf = usePdfExport();
  const view = views.find((v) => v.key === tab);
  const tabTitle = view ? `${title} — ${view.title}` : `${title} — الملخص`;
  const scope = `من ${dateLabel(from)} إلى ${dateLabel(to)}`;

  function exportCsv() {
    if (view) {
      const [h, rows] = csvOf(view);
      downloadCsv(`${fileBase}-${view.title}-${from}-${to}`, h, rows);
    } else downloadCsv(`${fileBase}-ملخص-${from}-${to}`, ["البند", "القيمة"], summaryFacts);
    toast.success("اتصدّر ملف Excel.");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <FileSpreadsheet /> Excel
            </Button>
            <Button variant="outline" disabled={pdf.busy} onClick={() => pdf.run(`${tabTitle}-${from}-${to}.pdf`, "اتصدّر التقرير PDF.")}>
              <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "تصدير PDF"}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">{filters}</div>

      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="summary">الملخص</TabsTrigger>
          {views.map((v) => (
            <TabsTrigger key={v.key} value={v.key}>
              {v.title}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="summary">{summary}</TabsContent>
        {views.map((v) => (
          <TabsContent key={v.key} value={v.key}>
            {v.kind === "group" ? <GroupTable view={v} /> : <DetailTable view={v} />}
          </TabsContent>
        ))}
      </Tabs>

      <OfficialDocument ref={pdf.ref} settings={db.settings} title={tabTitle} subtitle={scope} issuedOn={dateLabel(isoDate(new Date()))} orientation="landscape">
        {view ? (
          <DocView view={view} />
        ) : (
          <>
            <table className="doc-table" style={{ marginBottom: 14 }}>
              <tbody>
                {summaryFacts.map(([k, v]) => (
                  <tr key={k} data-pdf-break>
                    <td className="text-start" style={{ fontWeight: 700 }}>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {views
              .filter((v) => v.kind === "group" && !v.dates)
              .slice(0, 3)
              .map((v) => (
                <div key={v.key}>
                  <div data-pdf-break style={{ fontWeight: 800, margin: "10px 0 6px" }}>{v.title}</div>
                  <DocView view={v} />
                </div>
              ))}
          </>
        )}
        <SignatureBlock roles={signatures} />
      </OfficialDocument>
    </div>
  );
}

/** Small labelled native select used in the report filter bars. */
export function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  allLabel: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 min-w-40 rounded-md border border-input bg-card px-3 text-sm text-foreground">
        <option value="all">{allLabel}</option>
        {options.map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </label>
  );
}

/** Top rows of a grouping as a compact card on the summary tab. */
export function TopCard({ title, rows, dates }: { title: string; rows: ReportGroup[]; dates?: boolean }) {
  return (
    <section className="ledger-card overflow-hidden">
      <h2 className="border-b bg-secondary/60 px-4 py-3 font-bold">{title}</h2>
      {rows.length ? (
        <ul className="divide-y text-sm">
          {rows.slice(0, 8).map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate">{dates ? dateLabel(g.key) : g.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {int(g.count)} • {Math.round(g.share * 100)}٪
                </span>
              </span>
              <span className="num font-semibold">{money(g.total)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">مفيش حركة في الفترة دي.</p>
      )}
    </section>
  );
}
