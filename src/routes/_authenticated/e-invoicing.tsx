import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  FileBadge,
  FileJson,
  Landmark,
  Pencil,
  Percent,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, EmptyRow, FieldRow, FilterBar, HeadRow, MonthYearPicker, TableCard, Td, Th } from "@/components/hospital/kit";
import { HOSPITAL } from "@/lib/hospital/constants";
import {
  DEFAULT_ETA_SETTINGS,
  EINVOICE_STATUS_LABELS,
  eInvoiceTotals,
  ETA_TAX_LABELS,
  etaDocument,
  RECEIVER_TYPES,
  validateEInvoice,
  vatPosition,
  type EInvoiceStatus,
  type EtaSettings,
  type EtaTaxType,
  type ReceiverType,
} from "@/lib/hospital/eta";
import { invoiceAmounts, supplierInvoiceTotals, WHT_TYPES, type WhtType } from "@/lib/hospital/finance";
import { dateLabel, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  deleteEInvoice,
  newId,
  saveEInvoice,
  saveEtaSettings,
  setEInvoiceStatus,
  useCan,
  useHospitalDB,
  type EInvoice,
  type EInvoiceLine,
  type HospitalDB,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/e-invoicing")({
  head: () => ({
    meta: [
      { title: "الفاتورة الإلكترونية والضرائب | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "إصدار فواتير إلكترونية بصيغة مصلحة الضرائب المصرية مع ضريبة القيمة المضافة والخصم تحت حساب الضريبة، ومتابعة حالتها.",
      },
      { property: "og:title", content: "الفاتورة الإلكترونية | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "فواتير إلكترونية جاهزة للتوقيع والرفع على منظومة الضرائب المصرية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EInvoicingPage,
});

const STATUS_TONE: Record<EInvoiceStatus, string> = {
  draft: "bg-copper/10 text-copper",
  submitted: "bg-primary/10 text-primary",
  accepted: "bg-income/10 text-income",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function EInvoicingPage() {
  const db = useHospitalDB();
  const canEdit = useCan("eInvoicing", "add");
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [status, setStatus] = useState<"all" | EInvoiceStatus>("all");
  const [editing, setEditing] = useState<{ inv: EInvoice | null; mode: "patient" | "insurer" | "manual" } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitting, setSubmitting] = useState<EInvoice | null>(null);
  const eta = db.settings.eta ?? DEFAULT_ETA_SETTINGS;
  const issuer = { taxId: db.settings.taxId, name: HOSPITAL.name };

  const rows = db.eInvoices
    .filter((e) => (period === "all" || e.date.startsWith(period)) && (status === "all" || e.status === status))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const pos = useMemo(
    () =>
      vatPosition(
        db.eInvoices,
        db.supplierInvoices.map((s) => ({ date: s.date, ...supplierInvoiceTotals(s.subtotal, s.vatApplicable, s.whtType) })),
        period === "all" ? "" : period,
      ),
    [db.eInvoices, db.supplierInvoices, period],
  );
  const setupIssues = validateEInvoice(
    { id: "", number: "", date: "", source: "manual", refIds: [], department: "", receiver: { type: "B", id: "123456789", name: "x" }, lines: [{ id: "", description: "x", itemCode: "x", qty: 1, unitPrice: 1, discount: 0, taxType: "exempt" }], whtType: "none", status: "draft", createdAt: 0 },
    issuer,
    eta,
  );

  function download(inv: EInvoice) {
    const doc = etaDocument(inv, issuer, eta);
    const blob = new Blob([JSON.stringify({ documents: [doc] }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${inv.number}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("تم تنزيل ملف الفاتورة بصيغة المصلحة — وقّعه وارفعه من أداة التوقيع.");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الضرائب"
        title="الفاتورة الإلكترونية والضرائب"
        description="فواتير بصيغة منظومة الفاتورة الإلكترونية (مصلحة الضرائب المصرية): الخدمات الطبية معفاة من ضريبة القيمة المضافة، والخدمات الأخرى ١٤٪، والخصم تحت حساب الضريبة يُحسب تلقائيًا للشركات. نزّل الملف ووقّعه بالتوكن ثم سجّل الرقم الموحد."
        actions={
          canEdit ? (
            <>
              <Button onClick={() => setEditing({ inv: null, mode: "patient" })}><Plus /> من إيصال مريض</Button>
              <Button variant="outline" onClick={() => setEditing({ inv: null, mode: "insurer" })}><ShieldCheck /> مطالبة شركة تأمين</Button>
              <Button variant="outline" onClick={() => setEditing({ inv: null, mode: "manual" })}><FileBadge /> فاتورة حرة</Button>
              <Button variant="ghost" onClick={() => setSettingsOpen(true)}><Settings2 /> إعدادات المنظومة</Button>
            </>
          ) : undefined
        }
      />

      {setupIssues.length > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-copper/40 bg-copper/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-copper" />
          <div className="flex-1">
            <p className="font-semibold">أكمل بيانات المستشفى على المنظومة قبل الرفع:</p>
            <ul className="mt-1 list-disc ps-5 text-xs">{setupIssues.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>استكمال</Button>}
        </div>
      )}

      <FilterBar>
        <MonthYearPicker period={period} onChange={setPeriod} allowAll />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="bg-card md:w-60" aria-label="الحالة"><SelectValue /></SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الحالات</SelectItem>
            {(Object.keys(EINVOICE_STATUS_LABELS) as EInvoiceStatus[]).map((s) => <SelectItem key={s} value={s}>{EINVOICE_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="ق.م مخرجات (مبيعات)" value={money(pos.output)} icon={Percent} tone="copper" hint={`${int(pos.count)} فاتورة`} />
        <StatCard label="ق.م مدخلات (مشتريات)" value={money(pos.input)} icon={Percent} hint="من فواتير الموردين" />
        <StatCard label="صافي ق.م المستحقة" value={money(pos.net)} icon={Landmark} tone={pos.net > 0 ? "expense" : "income"} hint={pos.net < 0 ? "رصيد دائن يُرحّل" : "تُسدد مع الإقرار الشهري"} />
        <StatCard label="خصم وتحصيل مستحق للتوريد" value={money(pos.whtToPay)} icon={Landmark} tone="primary" hint="نموذج ٤١ — من الموردين" />
        <StatCard label="خصم استقطعته منا الشركات" value={money(pos.whtByCustomers)} icon={Landmark} hint="رصيد مدين تحت حساب الضريبة" />
      </div>

      <TableCard minWidth={1100}>
        <thead>
          <HeadRow>
            <Th>الفاتورة</Th>
            <Th>التاريخ</Th>
            <Th>المستلم</Th>
            <Th num>الصافي</Th>
            <Th num>ق.م</Th>
            <Th num>خصم وتحصيل</Th>
            <Th num>الإجمالي</Th>
            <Th>الحالة</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((e) => {
            const t = eInvoiceTotals(e);
            const issues = validateEInvoice(e, issuer, eta);
            return (
              <tr key={e.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td className="font-mono text-xs">
                  <span dir="ltr">{e.number}</span>
                  <p className="font-sans text-[11px] text-muted-foreground">{e.source === "patient" ? "إيصال مريض" : e.source === "insurer" ? "مطالبة تأمين" : "فاتورة حرة"}</p>
                  {e.etaUuid && <p dir="ltr" className="max-w-40 truncate text-right text-[10px] text-primary" title={e.etaUuid}>{e.etaUuid}</p>}
                </Td>
                <Td num className="text-right">{dateLabel(e.date)}</Td>
                <Td>
                  <p className="font-semibold">{e.receiver.name}</p>
                  <p className="text-[11px] text-muted-foreground">{e.receiver.type === "B" ? "شركة" : e.receiver.type === "P" ? "شخص" : "أجنبي"}{e.receiver.id && <> • <span dir="ltr">{e.receiver.id}</span></>}</p>
                </Td>
                <Td num>{money(t.net)}</Td>
                <Td num className="text-copper">{money(t.vat)}</Td>
                <Td num className="text-primary">{money(t.wht)}</Td>
                <Td num className="font-bold">{money(t.total)}</Td>
                <Td>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", STATUS_TONE[e.status])}>{EINVOICE_STATUS_LABELS[e.status]}</span>
                  {e.status === "draft" && issues.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive" title={issues.join("\n")}><AlertTriangle className="size-3" /> {int(issues.length)} ملاحظة قبل الرفع</p>
                  )}
                  {e.statusNote && <p className="mt-1 max-w-48 text-[11px] text-muted-foreground">{e.statusNote}</p>}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label="تنزيل ملف المنظومة" title="تنزيل ملف المنظومة (JSON)" disabled={issues.length > 0} onClick={() => download(e)}><FileJson /></Button>
                    {canEdit && e.status === "draft" && (
                      <>
                        <Button variant="ghost" size="icon" aria-label="تعديل" onClick={() => setEditing({ inv: e, mode: e.source })}><Pencil /></Button>
                        <Button variant="ghost" size="icon" aria-label="تسجيل الرفع" title="تسجيل الرفع على المنظومة" disabled={issues.length > 0} onClick={() => setSubmitting(e)}><Send /></Button>
                        <Button variant="ghost" size="icon" aria-label="حذف المسودة" className="text-muted-foreground hover:text-destructive" onClick={() => window.confirm("حذف المسودة؟") && deleteEInvoice(e.id)}><Trash2 /></Button>
                      </>
                    )}
                    {canEdit && e.status === "submitted" && (
                      <>
                        <Button variant="ghost" size="icon" aria-label="مقبولة" title="قبلتها المصلحة" onClick={() => setEInvoiceStatus({ id: e.id, status: "accepted" })}><CheckCircle2 className="text-income" /></Button>
                        <Button variant="ghost" size="icon" aria-label="مرفوضة" title="رفضتها المصلحة" onClick={() => { const note = window.prompt("سبب الرفض كما ظهر على المنظومة:") ?? ""; setEInvoiceStatus({ id: e.id, status: "rejected", note }); }}><XCircle className="text-destructive" /></Button>
                      </>
                    )}
                    {canEdit && e.status === "rejected" && (
                      <Button variant="ghost" size="icon" aria-label="إعادة للمسودة" title="إعادة للمسودة للتصحيح" onClick={() => setEInvoiceStatus({ id: e.id, status: "draft" })}><Undo2 /></Button>
                    )}
                    {canEdit && e.status === "accepted" && (
                      <Button variant="ghost" size="icon" aria-label="إلغاء" title="إلغاء الفاتورة (بعد إلغائها على المنظومة)" onClick={() => { const note = window.prompt("سبب الإلغاء:"); if (note !== null) setEInvoiceStatus({ id: e.id, status: "cancelled", note }); }}><Ban /></Button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={9} text={`لا توجد فواتير إلكترونية ${period === "all" ? "" : `في ${monthLabel(period)}`}.`} />}
        </tbody>
      </TableCard>

      {editing && <EInvoiceDialog key={editing.inv?.id ?? editing.mode} inv={editing.inv} mode={editing.mode} onClose={() => setEditing(null)} />}
      {settingsOpen && <EtaSettingsDialog onClose={() => setSettingsOpen(false)} />}
      {submitting && <SubmitDialog inv={submitting} onClose={() => setSubmitting(null)} />}
    </div>
  );
}

const emptyLine = (code: string): EInvoiceLine => ({ id: newId(), description: "", itemCode: code, qty: 1, unitPrice: 0, discount: 0, taxType: "exempt" });

/** Lines of an e-invoice built from a patient receipt (the patient's share when insured). */
function linesFromReceipt(db: HospitalDB, invoiceId: string, code: string): EInvoiceLine[] {
  const inv = db.patientInvoices.find((i) => i.id === invoiceId);
  if (!inv) return [];
  const a = invoiceAmounts(inv);
  if (inv.payer)
    return [{ ...emptyLine(code), description: `نصيب المريض من خدمات طبية — إيصال ${inv.number}`, unitPrice: a.patientShare }];
  const raw: { description: string; qty: number; unitPrice: number }[] = [
    ...inv.items.map((i) => ({ description: i.description, qty: i.qty, unitPrice: i.unitPrice })),
    ...(a.room ? [{ description: `إقامة ${a.days} يوم`, qty: 1, unitPrice: a.room }] : []),
    ...(a.supervision ? [{ description: `إشراف طبي ${a.days} يوم`, qty: 1, unitPrice: a.supervision }] : []),
  ];
  const sub = raw.reduce((s, r) => s + r.qty * r.unitPrice, 0) || 1;
  return raw.map((r) => ({
    ...emptyLine(code),
    description: r.description,
    qty: r.qty,
    unitPrice: r.unitPrice,
    discount: Math.round(((a.discount * r.qty * r.unitPrice) / sub) * 100) / 100,
  }));
}

function EInvoiceDialog({ inv, mode, onClose }: { inv: EInvoice | null; mode: "patient" | "insurer" | "manual"; onClose: () => void }) {
  const db = useHospitalDB();
  const eta = db.settings.eta ?? DEFAULT_ETA_SETTINGS;
  const code = eta.defaultItemCode;
  const [f, setF] = useState(() => ({
    date: inv?.date ?? isoDate(new Date()),
    department: inv?.department ?? "general",
    receiver: inv?.receiver ?? { type: (mode === "patient" ? "P" : "B") as ReceiverType, id: "", name: "" },
    lines: inv?.lines ?? (mode === "manual" ? [emptyLine(code)] : []),
    whtType: inv?.whtType ?? ((mode === "patient" ? "none" : "services") as WhtType),
    refIds: inv?.refIds ?? [],
  }));
  const [claim, setClaim] = useState({ payerId: db.lists.payers[0]?.id ?? "", period: periodOf(new Date()) });
  const used = new Set(db.eInvoices.filter((e) => e.id !== inv?.id && e.status !== "cancelled").flatMap((e) => e.source === "patient" ? e.refIds : []));
  const claimed = new Set(db.eInvoices.filter((e) => e.id !== inv?.id && e.status !== "cancelled" && e.source === "insurer").flatMap((e) => e.refIds));
  const receipts = db.patientInvoices.filter((i) => i.date.startsWith(f.date.slice(0, 7)) && !used.has(i.id)).sort((a, b) => b.date.localeCompare(a.date));
  const t = eInvoiceTotals(f);

  function pickReceipt(id: string) {
    const r = db.patientInvoices.find((i) => i.id === id);
    if (!r) return;
    setF({ ...f, refIds: [id], date: r.date, department: r.department, receiver: { ...f.receiver, type: "P", name: r.patientName }, lines: linesFromReceipt(db, id, code), whtType: "none" });
  }
  function buildClaim() {
    const payer = db.lists.payers.find((p) => p.id === claim.payerId);
    if (!payer) { toast.error("اختر جهة التأمين."); return; }
    const list = db.patientInvoices.filter((i) => i.payer?.payerId === payer.id && i.date.startsWith(claim.period) && !claimed.has(i.id));
    if (!list.length) { toast.error("لا توجد إيصالات لهذه الجهة في الشهر (أو تمت مطالبتها)."); return; }
    const prevTax = [...db.eInvoices].reverse().find((e) => e.receiver.name === payer.name)?.receiver.id;
    const depts = [...new Set(list.map((i) => i.department))];
    setF({
      ...f,
      refIds: list.map((i) => i.id),
      department: depts.length === 1 ? depts[0]! : "general",
      receiver: { type: "B", id: payer.taxId ?? prevTax ?? "", name: payer.name },
      lines: list.map((i) => ({ ...emptyLine(code), description: `خدمات طبية — ${i.patientName} — إيصال ${i.number}`, unitPrice: invoiceAmounts(i).insurerShare })),
    });
  }
  const setLine = (i: number, patch: Partial<EInvoiceLine>) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[94vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {inv ? `تعديل ${inv.number}` : mode === "patient" ? "فاتورة إلكترونية من إيصال مريض" : mode === "insurer" ? "فاتورة مطالبة لشركة تأمين" : "فاتورة إلكترونية حرة"}
          </DialogTitle>
          <DialogDescription>الأسعار بدون ضريبة. البنود الطبية معفاة؛ غيّر نوع الضريبة للبنود غير الطبية (كافيتريا، تجميل غير علاجي...).</DialogDescription>
        </DialogHeader>

        {mode === "patient" && !inv && (
          <FieldRow label="الإيصال">
            <Select value={f.refIds[0] ?? ""} onValueChange={pickReceipt}>
              <SelectTrigger aria-label="اختر الإيصال"><SelectValue placeholder="اختر إيصال مريض من نفس الشهر" /></SelectTrigger>
              <SelectContent dir="rtl" className="max-h-72">
                {receipts.map((r) => <SelectItem key={r.id} value={r.id}>{r.number} — {r.patientName} — {money(invoiceAmounts(r).total)}</SelectItem>)}
              </SelectContent>
            </Select>
          </FieldRow>
        )}
        {mode === "insurer" && !inv && (
          <div className="grid items-end gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_auto_auto]">
            <FieldRow label="جهة التأمين / التعاقد">
              <Select value={claim.payerId} onValueChange={(v) => setClaim({ ...claim, payerId: v })}>
                <SelectTrigger aria-label="جهة التأمين"><SelectValue placeholder="لا توجد جهات — أضفها من صفحة التأمين" /></SelectTrigger>
                <SelectContent dir="rtl">{db.lists.payers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </FieldRow>
            <MonthYearPicker period={claim.period} onChange={(p) => setClaim({ ...claim, period: p })} />
            <Button type="button" variant="outline" onClick={buildClaim}>تجميع الإيصالات</Button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <FieldRow label="نوع المستلم">
            <Select value={f.receiver.type} onValueChange={(v) => setF({ ...f, receiver: { ...f.receiver, type: v as ReceiverType } })}>
              <SelectTrigger aria-label="نوع المستلم"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">{(Object.keys(RECEIVER_TYPES) as ReceiverType[]).map((k) => <SelectItem key={k} value={k}>{RECEIVER_TYPES[k]}</SelectItem>)}</SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="اسم المستلم" htmlFor="ei-name" className="sm:col-span-2">
            <Input id="ei-name" value={f.receiver.name} onChange={(e) => setF({ ...f, receiver: { ...f.receiver, name: e.target.value } })} />
          </FieldRow>
          <FieldRow label={f.receiver.type === "B" ? "رقم التسجيل الضريبي" : f.receiver.type === "P" ? "الرقم القومي" : "رقم الجواز"} htmlFor="ei-id">
            <Input id="ei-id" dir="ltr" value={f.receiver.id} onChange={(e) => setF({ ...f, receiver: { ...f.receiver, id: e.target.value } })} />
          </FieldRow>
          <FieldRow label="التاريخ" htmlFor="ei-date"><Input id="ei-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></FieldRow>
          <FieldRow label="مركز التكلفة"><DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} /></FieldRow>
          <FieldRow label="الخصم تحت حساب الضريبة (يستقطعه المشتري)" className="sm:col-span-2">
            <Select value={f.whtType} onValueChange={(v) => setF({ ...f, whtType: v as WhtType })}>
              <SelectTrigger aria-label="الخصم تحت حساب الضريبة"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">{(Object.keys(WHT_TYPES) as WhtType[]).map((k) => <SelectItem key={k} value={k}>{WHT_TYPES[k].label}</SelectItem>)}</SelectContent>
            </Select>
          </FieldRow>
        </div>

        <TableCard minWidth={820}>
          <thead>
            <HeadRow>
              <Th>البيان</Th>
              <Th>كود الصنف (EGS)</Th>
              <Th num>الكمية</Th>
              <Th num>سعر الوحدة</Th>
              <Th num>خصم</Th>
              <Th>الضريبة</Th>
              <Th />
            </HeadRow>
          </thead>
          <tbody>
            {f.lines.map((l, i) => (
              <tr key={l.id} className="border-b last:border-0">
                <Td><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="البيان" className="h-8 min-w-48" /></Td>
                <Td><Input dir="ltr" value={l.itemCode} placeholder={code || "EG-…"} onChange={(e) => setLine(i, { itemCode: e.target.value })} aria-label="كود الصنف" className="h-8 w-32" /></Td>
                <Td><Input type="number" step="0.01" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} aria-label="الكمية" className="h-8 w-20" /></Td>
                <Td><Input type="number" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} aria-label="سعر الوحدة" className="h-8 w-28" /></Td>
                <Td><Input type="number" step="0.01" value={l.discount} onChange={(e) => setLine(i, { discount: Number(e.target.value) })} aria-label="الخصم" className="h-8 w-24" /></Td>
                <Td>
                  <Select value={l.taxType} onValueChange={(v) => setLine(i, { taxType: v as EtaTaxType })}>
                    <SelectTrigger className="h-8 w-48" aria-label="نوع الضريبة"><SelectValue /></SelectTrigger>
                    <SelectContent dir="rtl">{(Object.keys(ETA_TAX_LABELS) as EtaTaxType[]).map((k) => <SelectItem key={k} value={k}>{ETA_TAX_LABELS[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </Td>
                <Td><Button variant="ghost" size="icon" aria-label="حذف البند" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><Trash2 /></Button></Td>
              </tr>
            ))}
            {!f.lines.length && <EmptyRow cols={7} text="اختر إيصالًا أو جمّع مطالبة، أو أضف بندًا." />}
          </tbody>
        </TableCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={() => setF({ ...f, lines: [...f.lines, emptyLine(code)] })}><Plus /> بند</Button>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>الصافي: <b className="num">{money(t.net)}</b></span>
            <span className="text-copper">ق.م: <b className="num">{money(t.vat)}</b></span>
            <span className="text-primary">خصم وتحصيل: <b className="num">{money(t.wht)}</b></span>
            <span>الإجمالي: <b className="num">{money(t.total)}</b></span>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              const ok = saveEInvoice(
                { date: f.date, source: inv?.source ?? mode, refIds: f.refIds, department: f.department, receiver: f.receiver, lines: f.lines, whtType: f.whtType },
                inv,
              );
              if (ok) {
                toast.success("تم حفظ الفاتورة الإلكترونية كمسودة.");
                onClose();
              }
            }}
          >
            حفظ المسودة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitDialog({ inv, onClose }: { inv: EInvoice; onClose: () => void }) {
  const [uuid, setUuid] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>تسجيل رفع {inv.number}</DialogTitle>
          <DialogDescription>بعد توقيع الملف ورفعه على منظومة الفاتورة الإلكترونية، الصق الرقم الموحد (UUID) الذي أعطته المنظومة.</DialogDescription>
        </DialogHeader>
        <FieldRow label="الرقم الموحد للفاتورة (UUID)" htmlFor="eta-uuid">
          <Input id="eta-uuid" dir="ltr" value={uuid} onChange={(e) => setUuid(e.target.value)} />
        </FieldRow>
        <DialogFooter>
          <Button onClick={() => setEInvoiceStatus({ id: inv.id, status: "submitted", etaUuid: uuid }) && onClose()}><Send /> تسجيل الرفع</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EtaSettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings } = useHospitalDB();
  const [taxId, setTaxId] = useState(settings.taxId);
  const [f, setF] = useState<EtaSettings>({ ...DEFAULT_ETA_SETTINGS, ...(settings.eta ?? {}) });
  const field = (k: keyof EtaSettings, label: string, ltr = false) => (
    <FieldRow label={label} htmlFor={`eta-${k}`}>
      <Input id={`eta-${k}`} dir={ltr ? "ltr" : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </FieldRow>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">بيانات المستشفى على منظومة الفاتورة الإلكترونية</DialogTitle>
          <DialogDescription>كما هي مسجلة على بوابة مصلحة الضرائب (invoicing.eta.gov.eg).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="رقم التسجيل الضريبي (٩ أرقام)" htmlFor="eta-tax"><Input id="eta-tax" dir="ltr" value={taxId} onChange={(e) => setTaxId(e.target.value)} /></FieldRow>
          {field("activityCode", "كود النشاط (8610 = أنشطة المستشفيات)", true)}
          {field("branchId", "كود الفرع (0 = الرئيسي)", true)}
          {field("defaultItemCode", "كود الصنف الافتراضي للخدمات (EGS)", true)}
          {field("governate", "المحافظة")}
          {field("regionCity", "المدينة / المركز")}
          {field("street", "الشارع")}
          {field("buildingNumber", "رقم المبنى")}
        </div>
        <DialogFooter>
          <Button onClick={() => saveEtaSettings({ eta: f, taxId }) && (toast.success("تم حفظ بيانات المنظومة."), onClose())}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

