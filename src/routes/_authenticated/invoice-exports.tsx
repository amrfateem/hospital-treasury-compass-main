import { createFileRoute, Link } from "@tanstack/react-router";
import { FileDown, FileSpreadsheet, FileText, History, Loader2, Printer, Receipt, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, HeadRow, SearchBox, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { InvoiceReportDocument } from "@/components/hospital/billing/InvoiceReportDocument";
import { ReceiptDocument } from "@/components/hospital/billing/ReceiptDocument";
import { DESK_ICONS } from "@/components/hospital/billing/desks";
import { RECEIPT_DESKS, type ReceiptDeskKey } from "@/lib/hospital/catalog";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import { invoiceAmounts } from "@/lib/hospital/finance";
import {
  deskTotals,
  EMPTY_FILTERS,
  exportedIds,
  filterInvoices,
  invoiceContext,
  invoicesCsv,
  type InvoiceFilters,
} from "@/lib/hospital/invoice-export";
import { startOfficialPdf } from "@/lib/hospital/pdf";
import {
  EXPORT_FORMAT_LABELS,
  listLabel,
  logInvoiceExport,
  useHospitalDB,
  type ExportFormat,
  type InvoiceExport,
  type PatientInvoice,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/invoice-exports")({
  head: () => ({
    meta: [
      { title: "إدارة تصدير الفواتير | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "تصدير فواتير الأقسام إلى Excel وتقارير PDF مجمّعة وإيصالات بالجملة مع سجل لكل دفعة تصدير.",
      },
      { property: "og:title", content: "إدارة تصدير الفواتير | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "فلترة الفواتير حسب القسم والفترة وجهة التعاقد وتصديرها مع سجل كامل.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExportsPage,
});

const ALL = "all";

function monthStart() {
  const t = isoDate(new Date());
  return `${t.slice(0, 7)}-01`;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportsPage() {
  const db = useHospitalDB();
  const [f, setF] = useState<InvoiceFilters>(() => ({ ...EMPTY_FILTERS, from: monthStart(), to: isoDate(new Date()) }));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [receiptFormat, setReceiptFormat] = useState<"a5" | "a4">("a5");
  const [report, setReport] = useState<{ invoices: PatientInvoice[]; period: string; filters: string; batchNo?: string | undefined } | null>(null);
  const [batch, setBatch] = useState<{ invoices: PatientInvoice[]; idx: number; format: "a4" | "a5"; filters: string; log: boolean } | null>(null);
  const builder = useRef<Awaited<ReturnType<typeof startOfficialPdf>> | null>(null);
  const pdf = usePdfExport();

  const exported = useMemo(() => exportedIds(db.invoiceExports), [db.invoiceExports]);
  const rows = useMemo(() => filterInvoices(db.patientInvoices, f, exported), [db.patientInvoices, f, exported]);
  const selection = picked.size ? rows.filter((r) => picked.has(r.id)) : rows;
  const totals = deskTotals(selection);
  const periodLabel = `${f.from ? dateLabel(f.from) : "البداية"} — ${f.to ? dateLabel(f.to) : "اليوم"}`;

  const filterText = [
    f.desks.length ? RECEIPT_DESKS.filter((d) => f.desks.includes(d.key)).map((d) => d.label).join("، ") : "",
    f.method !== ALL ? listLabel(db.lists.paymentMethods, f.method) : "",
    f.payer === "none" ? "بدون تعاقد" : f.payer !== ALL ? listLabel(db.lists.payers, f.payer) : "",
    f.status === "new" ? "غير مُصدَّرة" : f.status === "exported" ? "مُصدَّرة سابقًا" : "",
    picked.size ? `${int(picked.size)} فاتورة مختارة` : "",
    f.query.trim() ? `بحث: ${f.query.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const set = <K extends keyof InvoiceFilters>(k: K, v: InvoiceFilters[K]) => {
    setF({ ...f, [k]: v });
    setPicked(new Set());
  };
  const toggleDesk = (k: ReceiptDeskKey) =>
    set("desks", f.desks.includes(k) ? f.desks.filter((x) => x !== k) : [...f.desks, k]);

  const record = (format: ExportFormat, invoices: PatientInvoice[], filters: string) =>
    logInvoiceExport({ format, from: f.from, to: f.to, filters, invoiceIds: invoices.map((i) => i.id) });

  function exportExcel(invoices = selection, filters = filterText, log = true) {
    if (!invoices.length) { toast.error("لا توجد فواتير للتصدير."); return; }
    download(`فواتير-${f.from || "الكل"}-${f.to || ""}.csv`, invoicesCsv(db, invoices), "text/csv;charset=utf-8");
    if (log) record("excel", invoices, filters);
    toast.success(`تم تصدير ${int(invoices.length)} فاتورة إلى Excel.`);
  }

  function exportReport(invoices = selection, filters = filterText, batchNo?: string) {
    if (!invoices.length) { toast.error("لا توجد فواتير للتصدير."); return; }
    setReport({ invoices, period: periodLabel, filters, batchNo });
  }

  useEffect(() => {
    if (!report) return;
    const id = requestAnimationFrame(() => {
      void pdf
        .run(`تقرير-الفواتير-${isoDate(new Date())}.pdf`, `تم تصدير تقرير ${int(report.invoices.length)} فاتورة.`)
        .then(() => {
          if (!report.batchNo) record("report", report.invoices, report.filters);
        })
        .finally(() => setReport(null));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  function exportReceipts(invoices = selection, filters = filterText, log = true) {
    if (!invoices.length) { toast.error("لا توجد فواتير للتصدير."); return; }
    if (invoices.length > 150 && !window.confirm(`سيتم تجهيز ${int(invoices.length)} إيصال وقد يستغرق ذلك عدة دقائق. متابعة؟`))
      return;
    builder.current = null;
    setBatch({ invoices, idx: 0, format: receiptFormat, filters, log });
  }

  // Receipts are rendered one at a time and appended to the same PDF.
  useEffect(() => {
    if (!batch) return;
    let cancelled = false;
    const id = requestAnimationFrame(async () => {
      try {
        if (!builder.current) builder.current = await startOfficialPdf();
        if (cancelled || !pdf.ref.current) return;
        await builder.current.add(pdf.ref.current);
        if (cancelled) return;
        if (batch.idx + 1 < batch.invoices.length) {
          setBatch({ ...batch, idx: batch.idx + 1 });
        } else {
          builder.current.save(`إيصالات-${isoDate(new Date())}-${batch.format.toUpperCase()}.pdf`);
          if (batch.log) record("receipts", batch.invoices, batch.filters);
          toast.success(`تم تصدير ${int(batch.invoices.length)} إيصال في ملف واحد.`);
          builder.current = null;
          setBatch(null);
        }
      } catch (e) {
        console.error(e);
        toast.error("تعذّر تجهيز ملف الإيصالات، حاول مرة أخرى.");
        builder.current = null;
        setBatch(null);
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch]);

  const busy = !!report || !!batch || pdf.busy;
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="دورة الإيرادات"
        title="إدارة تصدير الفواتير"
        description="فلتر فواتير الأقسام بالفترة والقسم وطريقة الدفع وجهة التعاقد، ثم صدّرها Excel أو تقرير PDF مجمّع أو إيصالات بالجملة — وكل عملية تصدير تُسجَّل برقم دفعة."
        actions={
          <Button variant="outline" asChild>
            <Link to="/billing">
              <Receipt /> الإيصالات
            </Link>
          </Button>
        }
      />

      <Tabs dir="rtl" defaultValue="export">
        <TabsList className="mb-4">
          <TabsTrigger value="export" className="gap-1.5">
            <FileDown className="size-4" /> تصدير
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-1.5">
            <History className="size-4" /> سجل التصدير ({int(db.invoiceExports.length)})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="export">
          <section className="ledger-card mb-4 grid gap-4 p-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="الأقسام">
              <Button size="sm" variant={f.desks.length ? "outline" : "default"} onClick={() => set("desks", [])}>
                كل الأقسام
              </Button>
              {RECEIPT_DESKS.map((d) => {
                const Icon = DESK_ICONS[d.key];
                const on = f.desks.includes(d.key);
                return (
                  <Button key={d.key} size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => toggleDesk(d.key)}>
                    <Icon /> {d.label}
                  </Button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="grid gap-1.5">
                <Label htmlFor="ex-from">من تاريخ</Label>
                <Input id="ex-from" type="date" value={f.from} onChange={(e) => set("from", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ex-to">إلى تاريخ</Label>
                <Input id="ex-to" type="date" value={f.to} onChange={(e) => set("to", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>طريقة الدفع</Label>
                <Select value={f.method} onValueChange={(v) => set("method", v)}>
                  <SelectTrigger aria-label="طريقة الدفع"><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value={ALL}>كل الطرق</SelectItem>
                    {db.lists.paymentMethods.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>جهة التعاقد</Label>
                <Select value={f.payer} onValueChange={(v) => set("payer", v)}>
                  <SelectTrigger aria-label="جهة التعاقد"><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value={ALL}>الكل</SelectItem>
                    <SelectItem value="none">نقدي بدون تعاقد</SelectItem>
                    {db.lists.payers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>حالة التصدير</Label>
                <Select value={f.status} onValueChange={(v) => set("status", v as InvoiceFilters["status"])}>
                  <SelectTrigger aria-label="حالة التصدير"><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="new">لم تُصدَّر بعد</SelectItem>
                    <SelectItem value="exported">مُصدَّرة سابقًا</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>بحث</Label>
                <SearchBox value={f.query} onChange={(v) => set("query", v)} placeholder="مريض أو رقم فاتورة" />
              </div>
            </div>
          </section>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={picked.size ? "فواتير مختارة" : "فواتير مطابقة"} value={int(totals.grand.count)} icon={FileText} />
            <StatCard label="صافي الإيرادات" value={money(totals.grand.total)} icon={Wallet} tone="income" hint="بالجنيه المصري" />
            <StatCard label="المحصَّل من المرضى" value={money(totals.grand.patientShare)} icon={Receipt} />
            <StatCard label="على جهات التعاقد" value={money(totals.grand.insurerShare)} icon={Receipt} tone="copper" />
          </div>

          <section className="ledger-card mb-4 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold">
                تصدير {picked.size ? `${int(picked.size)} فاتورة مختارة` : `كل الفواتير المطابقة (${int(rows.length)})`}
              </p>
              <p className="text-xs text-muted-foreground">
                {picked.size ? "ألغِ الاختيار لتصدير كل النتائج." : "اختر فواتير بعينها من الجدول لتصديرها فقط."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => exportExcel()} disabled={busy || !selection.length}>
                <FileSpreadsheet /> Excel
              </Button>
              <Button variant="secondary" onClick={() => exportReport()} disabled={busy || !selection.length}>
                <FileText /> تقرير PDF مجمّع
              </Button>
              <div className="flex items-center gap-1 rounded-md border p-0.5">
                <Select value={receiptFormat} onValueChange={(v) => setReceiptFormat(v as "a4" | "a5")}>
                  <SelectTrigger className="h-8 w-20 border-0 shadow-none" aria-label="مقاس الإيصالات"><SelectValue /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="a5">A5</SelectItem>
                    <SelectItem value="a4">A4</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => exportReceipts()} disabled={busy || !selection.length}>
                  <Printer /> إيصالات PDF
                </Button>
              </div>
            </div>
          </section>

          {batch && (
            <p className="mb-4 flex items-center gap-2 rounded-lg border border-dashed bg-muted/50 p-3 text-sm" role="status">
              <Loader2 className="size-4 animate-spin" /> جاري تجهيز الإيصال {int(batch.idx + 1)} من {int(batch.invoices.length)}...
            </p>
          )}

          {totals.rows.length > 0 && (
            <div className="mb-4">
            <TableCard minWidth={760}>
              <thead>
                <HeadRow>
                  <Th>القسم</Th>
                  <Th num>العدد</Th>
                  <Th num>الإجمالي</Th>
                  <Th num>الخصم</Th>
                  <Th num>الصافي</Th>
                  <Th num>جهات التعاقد</Th>
                  <Th num>المحصَّل</Th>
                </HeadRow>
              </thead>
              <tbody>
                {totals.rows.map((r) => {
                  const Icon = DESK_ICONS[r.key];
                  return (
                    <tr key={r.key} className="border-b">
                      <Td><span className="flex items-center gap-2 font-semibold"><Icon className="size-4 text-primary" /> {r.label}</span></Td>
                      <Td num>{int(r.count)}</Td>
                      <Td num>{money(r.subtotal)}</Td>
                      <Td num className="text-muted-foreground">{money(r.discount)}</Td>
                      <Td num className="font-semibold">{money(r.total)}</Td>
                      <Td num>{money(r.insurerShare)}</Td>
                      <Td num className="font-bold text-income">{money(r.patientShare)}</Td>
                    </tr>
                  );
                })}
                <tr className="bg-muted/60 font-bold">
                  <Td>الإجمالي</Td>
                  <Td num>{int(totals.grand.count)}</Td>
                  <Td num>{money(totals.grand.subtotal)}</Td>
                  <Td num>{money(totals.grand.discount)}</Td>
                  <Td num>{money(totals.grand.total)}</Td>
                  <Td num>{money(totals.grand.insurerShare)}</Td>
                  <Td num className="text-income">{money(totals.grand.patientShare)}</Td>
                </tr>
              </tbody>
            </TableCard>
            </div>
          )}

          <TableCard minWidth={860}>
            <thead>
              <HeadRow>
                <Th className="w-10">
                  <Checkbox
                    aria-label="اختيار الكل"
                    checked={allPicked ? true : picked.size ? "indeterminate" : false}
                    onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </Th>
                <Th>رقم الفاتورة</Th>
                <Th>التاريخ</Th>
                <Th>المريض</Th>
                <Th>القسم</Th>
                <Th>الدفع</Th>
                <Th num>الصافي</Th>
                <Th num>المدفوع</Th>
                <Th>الحالة</Th>
              </HeadRow>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const a = invoiceAmounts(inv);
                const c = invoiceContext(db, inv);
                const on = picked.has(inv.id);
                return (
                  <tr key={inv.id} className={cn("border-b last:border-0 hover:bg-muted/50", on && "bg-primary/5")}>
                    <Td>
                      <Checkbox
                        aria-label={`اختيار ${inv.number}`}
                        checked={on}
                        onCheckedChange={() => {
                          const n = new Set(picked);
                          if (on) n.delete(inv.id);
                          else n.add(inv.id);
                          setPicked(n);
                        }}
                      />
                    </Td>
                    <Td className="font-mono text-xs"><span dir="ltr">{inv.number}</span></Td>
                    <Td num className="text-right">{dateLabel(inv.date)}</Td>
                    <Td>
                      <p className="font-semibold">{inv.patientName}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {[c.clinic && `عيادة ${c.clinic}`, c.referredBy, c.doctor && `د. ${c.doctor}`].filter(Boolean).join(" — ") ||
                          inv.items.map((x) => x.description).join("، ")}
                      </p>
                    </Td>
                    <Td><DeptBadge id={inv.department} /></Td>
                    <Td className="text-xs">
                      {listLabel(db.lists.paymentMethods, inv.paymentMethod)}
                      {inv.payer && <p className="text-[11px] text-muted-foreground">{listLabel(db.lists.payers, inv.payer.payerId)}</p>}
                    </Td>
                    <Td num>{money(a.total)}</Td>
                    <Td num className="font-semibold text-income">{money(a.patientShare)}</Td>
                    <Td>
                      {exported.has(inv.id) ? (
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">مُصدَّرة</span>
                      ) : (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">جديدة</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {!rows.length && <EmptyRow cols={9} text="لا توجد فواتير مطابقة للفلاتر." />}
            </tbody>
          </TableCard>
        </TabsContent>

        <TabsContent value="log">
          <ExportLog
            exports={db.invoiceExports}
            busy={busy}
            onExcel={(e, invs) => exportExcel(invs, e.filters, false)}
            onReport={(e, invs) => exportReport(invs, e.filters, e.number)}
            onReceipts={(e, invs) => exportReceipts(invs, e.filters, false)}
            invoicesOf={(e) => db.patientInvoices.filter((i) => e.invoiceIds.includes(i.id))}
          />
        </TabsContent>
      </Tabs>

      {report && (
        <InvoiceReportDocument
          ref={pdf.ref}
          db={db}
          invoices={report.invoices}
          period={report.period}
          filters={report.filters}
          batchNo={report.batchNo}
        />
      )}
      {batch && batch.invoices[batch.idx] && (
        <ReceiptDocument ref={pdf.ref} db={db} invoice={batch.invoices[batch.idx]!} format={batch.format} />
      )}
    </div>
  );
}

function ExportLog({
  exports,
  busy,
  onExcel,
  onReport,
  onReceipts,
  invoicesOf,
}: {
  exports: InvoiceExport[];
  busy: boolean;
  onExcel: (e: InvoiceExport, invs: PatientInvoice[]) => void;
  onReport: (e: InvoiceExport, invs: PatientInvoice[]) => void;
  onReceipts: (e: InvoiceExport, invs: PatientInvoice[]) => void;
  invoicesOf: (e: InvoiceExport) => PatientInvoice[];
}) {
  const sorted = [...exports].sort((a, b) => b.at - a.at);
  return (
    <TableCard minWidth={880}>
      <thead>
        <HeadRow>
          <Th>رقم الدفعة</Th>
          <Th>وقت التصدير</Th>
          <Th>بواسطة</Th>
          <Th>الصيغة</Th>
          <Th>الفترة والفلاتر</Th>
          <Th num>العدد</Th>
          <Th num>الصافي</Th>
          <Th className="text-left">إعادة التنزيل</Th>
        </HeadRow>
      </thead>
      <tbody>
        {sorted.map((e) => {
          const invs = invoicesOf(e);
          return (
            <tr key={e.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td className="font-mono text-xs"><span dir="ltr">{e.number}</span></Td>
              <Td className="text-xs">{new Date(e.at).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</Td>
              <Td>{e.by}</Td>
              <Td className="text-xs">{EXPORT_FORMAT_LABELS[e.format]}</Td>
              <Td className="text-xs">
                <p>{e.from ? dateLabel(e.from) : "البداية"} — {e.to ? dateLabel(e.to) : "اليوم"}</p>
                {e.filters && <p className="text-muted-foreground">{e.filters}</p>}
              </Td>
              <Td num>
                {int(e.count)}
                {invs.length !== e.count && <p className="text-[10px] text-destructive">{int(e.count - invs.length)} حُذفت</p>}
              </Td>
              <Td num className="font-semibold">{money(e.total)}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" disabled={busy || !invs.length} onClick={() => onExcel(e, invs)}>
                    <FileSpreadsheet /> Excel
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy || !invs.length} onClick={() => onReport(e, invs)}>
                    <FileText /> تقرير
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || !invs.length} onClick={() => onReceipts(e, invs)}>
                    <Printer /> إيصالات
                  </Button>
                </div>
              </Td>
            </tr>
          );
        })}
        {!sorted.length && <EmptyRow cols={8} text="لم تُصدَّر أي فواتير بعد." />}
      </tbody>
    </TableCard>
  );
}
