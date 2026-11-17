import { createFileRoute } from "@tanstack/react-router";
import { FileDown, FileScan, Landmark, Pencil, Percent, Plus, Sparkles, Trash2, Truck, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { findDepartment, type DepartmentId } from "@/lib/hospital/constants";
import { dateLabel, egp, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  supplierInvoiceTotals,
  WHT_THRESHOLD,
  WHT_TYPES,
  type WhtType,
} from "@/lib/hospital/finance";
import {
  deleteInvoiceDraft,
  deleteSupplierInvoice,
  listLabel,
  newId,
  saveInvoiceDraft,
  saveSupplierInvoice,
  useCan,
  useHospitalDB,
  type InvoiceDraft,
  type SupplierInvoice,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";
import { readSupplierInvoice } from "@/lib/hospital/ocr.functions";
import { aiFileProblem, fileToBase64 } from "@/lib/hospital/file";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({
    meta: [
      { title: "مشتريات المستلزمات الطبية والتشغيل | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "تسجيل فواتير الموردين لكل قسم مع احتساب ضريبة القيمة المضافة ١٤٪ وضريبة الخصم والتحصيل.",
      },
      { property: "og:title", content: "مشتريات الموردين | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "فواتير الموردين وضريبة القيمة المضافة والخصم والتحصيل لكل قسم.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuppliersPage,
});

function SuppliersPage() {
  const db = useHospitalDB();
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [dept, setDept] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierInvoice | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const pdf = usePdfExport();

  const rows = useMemo(
    () =>
      db.supplierInvoices
        .filter(
          (i) =>
            (period === "all" || i.date.startsWith(period)) &&
            (dept === "all" || i.department === dept) &&
            matches(
              query,
              i.supplierName,
              i.description,
              i.number,
              i.supplierInvoiceNo,
              listLabel(db.lists.expenseCategories, i.category),
            ),
        )
        .map((inv) => ({
          inv,
          ...supplierInvoiceTotals(inv.subtotal, inv.vatApplicable, inv.whtType),
        }))
        .sort((a, b) => a.inv.date.localeCompare(b.inv.date) || a.inv.createdAt - b.inv.createdAt),
    [db.supplierInvoices, db.lists.expenseCategories, period, dept, query],
  );
  const t = rows.reduce(
    (s, r) => ({
      subtotal: s.subtotal + r.subtotal,
      vat: s.vat + r.vat,
      wht: s.wht + r.wht,
      total: s.total + r.total,
      payable: s.payable + r.payable,
    }),
    { subtotal: 0, vat: 0, wht: 0, total: 0, payable: 0 },
  );
  const scope = `${period === "all" ? "كل الفترات" : `شهر ${monthLabel(period)}`} — ${dept === "all" ? "جميع الأقسام" : `قسم ${findDepartment(db.departments, dept).name}`}`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="فواتير الموردين"
        title="مشتريات المستلزمات الطبية والتشغيل"
        description={`ضريبة القيمة المضافة ١٤٪ وضريبة الخصم والتحصيل تُحسب تلقائيًا (من ${int(WHT_THRESHOLD)} ج.م فأكثر، على القيمة قبل الضريبة). المبلغ المدفوع للمورد يُسجَّل كمصروف في الخزينة.`}
        actions={
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setDraft(null);
                setOpen(true);
              }}
            >
              <Plus /> فاتورة مورد
            </Button>
            <AiReadButton />
            <Button
              variant="outline"
              disabled={pdf.busy}
              onClick={() => pdf.run(`سجل-المشتريات-${period}.pdf`, "تم تصدير سجل المشتريات.")}
            >
              <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "تصدير سجل المشتريات PDF"}
            </Button>
          </>
        }
      />

      <div className="ledger-card mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <MonthYearPicker period={period} onChange={setPeriod} allowAll />
        <div className="flex flex-col gap-2 sm:flex-row">
          <DeptSelect value={dept} onChange={setDept} allowAll className="sm:w-60" />
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="بحث بالمورد أو البيان"
            className="sm:w-64"
          />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="القيمة قبل الضريبة"
          value={money(t.subtotal)}
          icon={Truck}
          hint={`${int(rows.length)} فاتورة`}
        />
        <StatCard
          label="ضريبة القيمة المضافة (١٤٪)"
          value={money(t.vat)}
          icon={Percent}
          tone="copper"
          hint="ضريبة مدخلات"
        />
        <StatCard
          label="الخصم والتحصيل المستقطع"
          value={money(t.wht)}
          icon={Landmark}
          tone="primary"
          hint="مستحق التوريد لمصلحة الضرائب"
        />
        <StatCard label="المدفوع للموردين" value={money(t.payable)} icon={Wallet} tone="expense" />
      </div>

      <DraftsPanel
        onReview={(d) => {
          setEditing(null);
          setDraft(d);
          setOpen(true);
        }}
      />

      <TableCard minWidth={1080}>
        <thead>
          <HeadRow>
            <Th>المرجع</Th>
            <Th>التاريخ</Th>
            <Th>المورد</Th>
            <Th>القسم</Th>
            <Th>البيان</Th>
            <Th num>القيمة</Th>
            <Th num>ق.م ١٤٪</Th>
            <Th num>خصم وتحصيل</Th>
            <Th num>المدفوع</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.inv.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td className="font-mono text-xs">
                <span dir="ltr">{r.inv.number}</span>
                <p className="text-[11px] text-muted-foreground">
                  فاتورة المورد: {r.inv.supplierInvoiceNo || "—"}
                </p>
              </Td>
              <Td num className="text-right">
                {dateLabel(r.inv.date)}
              </Td>
              <Td>
                <p className="font-semibold">{r.inv.supplierName}</p>
                {r.inv.supplierTaxId && (
                  <p className="text-[11px] text-muted-foreground">ر.ض: {r.inv.supplierTaxId}</p>
                )}
              </Td>
              <Td>
                <DeptBadge id={r.inv.department} />
              </Td>
              <Td>
                <p>{r.inv.description}</p>
                <p className="text-[11px] text-muted-foreground">
                  {listLabel(db.lists.expenseCategories, r.inv.category)} •{" "}
                  {WHT_TYPES[r.inv.whtType].label}
                </p>
              </Td>
              <Td num>{money(r.subtotal)}</Td>
              <Td num className="text-copper">
                {money(r.vat)}
              </Td>
              <Td num className="text-primary">
                {money(r.wht)}
              </Td>
              <Td num className="font-bold text-expense">
                {money(r.payable)}
              </Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="تعديل الفاتورة"
                    onClick={() => {
                      setEditing(r.inv);
                      setDraft(null);
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="حذف الفاتورة"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (window.confirm("حذف فاتورة المورد؟ سيُحذف قيدها من الخزينة أيضًا.")) {
                        deleteSupplierInvoice(r.inv.id);
                        toast.success("تم حذف الفاتورة وقيدها.");
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={10} text="لا توجد فواتير موردين في هذه الفترة." />}
        </tbody>
      </TableCard>

      <SupplierDialog
        open={open}
        onOpenChange={setOpen}
        invoice={editing}
        draft={draft}
        defaultDepartment={dept === "all" ? "purchasing" : dept}
      />

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        orientation="landscape"
        title="سجل فواتير المشتريات وضريبة القيمة المضافة والخصم والتحصيل"
        subtitle={scope}
        issuedOn={dateLabel(isoDate(new Date()))}
      >
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>م</th>
              <th>التاريخ</th>
              <th>المرجع</th>
              <th>رقم فاتورة المورد</th>
              <th>اسم المورد</th>
              <th>الرقم الضريبي للمورد</th>
              <th>القسم</th>
              <th>البيان</th>
              <th>القيمة قبل الضريبة</th>
              <th>ضريبة ق.م ١٤٪</th>
              <th>الإجمالي</th>
              <th>الخصم والتحصيل</th>
              <th>المدفوع</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.inv.id} data-pdf-break>
                <td>{int(i + 1)}</td>
                <td>{dateLabel(r.inv.date)}</td>
                <td dir="ltr">{r.inv.number}</td>
                <td dir="ltr">{r.inv.supplierInvoiceNo || "—"}</td>
                <td className="text-start">{r.inv.supplierName}</td>
                <td dir="ltr">{r.inv.supplierTaxId || "—"}</td>
                <td>{findDepartment(db.departments, r.inv.department).name}</td>
                <td className="text-start">{r.inv.description}</td>
                <td>{money(r.subtotal)}</td>
                <td>{money(r.vat)}</td>
                <td>{money(r.total)}</td>
                <td>{money(r.wht)}</td>
                <td>{money(r.payable)}</td>
              </tr>
            ))}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={8} className="text-start">
                الإجمالي ({int(rows.length)} فاتورة)
              </td>
              <td>{money(t.subtotal)}</td>
              <td>{money(t.vat)}</td>
              <td>{money(t.total)}</td>
              <td>{money(t.wht)}</td>
              <td>{money(t.payable)}</td>
            </tr>
          </tbody>
        </table>
        <p data-pdf-break style={{ fontSize: 11.5, marginTop: 10, color: "var(--doc-muted)" }}>
          ضريبة القيمة المضافة وفق القانون ٦٧ لسنة ٢٠١٦ بسعر ١٤٪. الخصم تحت حساب الضريبة يُحتسب على
          القيمة قبل الضريبة للفواتير من {int(WHT_THRESHOLD)} ج.م فأكثر، ويُورَّد لمصلحة الضرائب على
          نموذج ٤١ خصم وإضافة.
        </p>
        <SignatureBlock roles={["مسؤول المشتريات", "المحاسب المختص", "المدير المالي"]} />
      </OfficialDocument>
    </div>
  );
}

function SupplierDialog({
  open,
  onOpenChange,
  invoice,
  draft,
  defaultDepartment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoice: SupplierInvoice | null;
  draft?: InvoiceDraft | null;
  defaultDepartment: DepartmentId;
}) {
  const { lists, supplierInvoices } = useHospitalDB();
  const [f, setF] = useState({
    date: "",
    supplierName: "",
    supplierTaxId: "",
    supplierInvoiceNo: "",
    department: defaultDepartment as DepartmentId,
    category: "medical",
    description: "",
    subtotal: "",
    vatApplicable: true,
    whtType: "supplies" as WhtType,
    terms: "cash" as "cash" | "credit",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (invoice) {
      setF({
        date: invoice.date,
        supplierName: invoice.supplierName,
        supplierTaxId: invoice.supplierTaxId ?? "",
        supplierInvoiceNo: invoice.supplierInvoiceNo,
        department: invoice.department,
        category: invoice.category,
        description: invoice.description,
        subtotal: String(invoice.subtotal),
        vatApplicable: invoice.vatApplicable,
        whtType: invoice.whtType,
        terms: invoice.terms ?? "cash",
      });
      return;
    }
    if (draft) {
      const sub = draft.subtotal ?? (draft.total != null ? draft.total / (draft.vatApplicable ? 1.14 : 1) : 0);
      setF({
        date: draft.date && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : isoDate(new Date()),
        supplierName: draft.supplierName,
        supplierTaxId: draft.supplierTaxId ?? "",
        supplierInvoiceNo: draft.supplierInvoiceNo ?? "",
        department: draft.department ?? defaultDepartment,
        category: draft.category && lists.expenseCategories.some((c) => c.id === draft.category) ? draft.category : (lists.expenseCategories[0]?.id ?? ""),
        description: draft.description,
        subtotal: sub ? String(Math.round(sub * 100) / 100) : "",
        vatApplicable: draft.vatApplicable,
        whtType: draft.whtType,
        terms: "credit",
      });
      return;
    }
    setF((p) => ({
      ...p,
      date: isoDate(new Date()),
      supplierName: "",
      supplierTaxId: "",
      supplierInvoiceNo: "",
      department: defaultDepartment,
      category: lists.expenseCategories.some((c) => c.id === p.category)
        ? p.category
        : (lists.expenseCategories[0]?.id ?? ""),
      description: "",
      subtotal: "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice, draft, defaultDepartment]);
  const supplierNames = [...new Set(supplierInvoices.map((i) => i.supplierName))];

  const totals = supplierInvoiceTotals(Number(f.subtotal) || 0, f.vatApplicable, f.whtType);
  const text = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.supplierName.trim() || !f.description.trim())
      return setError("اكتب اسم المورد وبيان الفاتورة.");
    if (!(Number(f.subtotal) > 0)) return setError("القيمة قبل الضريبة يجب أن تكون أكبر من صفر.");
    const ok = saveSupplierInvoice(
      {
        date: f.date,
        supplierName: f.supplierName.trim(),
        supplierTaxId: f.supplierTaxId.trim() || undefined,
        supplierInvoiceNo: f.supplierInvoiceNo.trim(),
        department: f.department,
        category: f.category,
        description: f.description.trim(),
        subtotal: Number(f.subtotal),
        vatApplicable: f.vatApplicable,
        whtType: f.whtType,
        terms: f.terms,
      },
      invoice,
    );
    if (!ok) return;
    if (draft) deleteInvoiceDraft(draft.id);
    toast.success(
      invoice
        ? "تم تعديل فاتورة المورد وتحديث قيدها بالخزينة."
        : f.terms === "credit"
          ? `تم تسجيل الفاتورة على حساب المورد (آجل) بقيمة ${egp(totals.payable)}.`
          : `تم تسجيل فاتورة المورد ودفع ${egp(totals.payable)} من الخزينة.`,
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {invoice ? "تعديل فاتورة مورد" : draft ? "مراجعة فاتورة مقروءة بالذكاء الاصطناعي" : "فاتورة مورد جديدة"}
          </DialogTitle>
          <DialogDescription>
            {draft
              ? `من الملف «${draft.fileName}» — راجع الأرقام مع الأصل قبل الحفظ.${draft.notes ? ` ملاحظة القراءة: ${draft.notes}` : ""}`
              : "يُسجَّل المبلغ المدفوع للمورد كمصروف (خارج) على القسم المختار."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="اسم المورد" htmlFor="sp-name">
              <Input
                id="sp-name"
                list="supplier-names"
                value={f.supplierName}
                onChange={text("supplierName")}
              />
              <datalist id="supplier-names">
                {supplierNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </FieldRow>
            <FieldRow label="الرقم الضريبي للمورد (اختياري)" htmlFor="sp-tax">
              <Input
                id="sp-tax"
                value={f.supplierTaxId}
                onChange={text("supplierTaxId")}
                dir="ltr"
              />
            </FieldRow>
            <FieldRow label="رقم فاتورة المورد" htmlFor="sp-no">
              <Input
                id="sp-no"
                value={f.supplierInvoiceNo}
                onChange={text("supplierInvoiceNo")}
                dir="ltr"
              />
            </FieldRow>
            <FieldRow label="التاريخ" htmlFor="sp-date">
              <Input id="sp-date" type="date" value={f.date} onChange={text("date")} required />
            </FieldRow>
            <FieldRow label="القسم (مركز التكلفة)">
              <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
            </FieldRow>
            <FieldRow label="نوع المشتريات / المصروف">
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger aria-label="نوع المشتريات">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {lists.expenseCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="البيان" htmlFor="sp-desc" className="sm:col-span-2">
              <Input
                id="sp-desc"
                value={f.description}
                onChange={text("description")}
                placeholder="مثال: محاليل وريدية وسرنجات"
              />
            </FieldRow>
            <FieldRow label="القيمة قبل الضريبة (ج.م)" htmlFor="sp-sub">
              <Input
                id="sp-sub"
                type="number"
                min="0"
                step="0.01"
                value={f.subtotal}
                onChange={text("subtotal")}
              />
            </FieldRow>
            <FieldRow label="ضريبة الخصم والتحصيل">
              <Select
                value={f.whtType}
                onValueChange={(v) => setF({ ...f, whtType: v as WhtType })}
              >
                <SelectTrigger aria-label="ضريبة الخصم والتحصيل">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {Object.entries(WHT_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="طريقة السداد">
              <Select value={f.terms} onValueChange={(v) => setF({ ...f, terms: v as "cash" | "credit" })}>
                <SelectTrigger aria-label="طريقة السداد">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="cash">نقدي — يُدفع الآن من الخزينة الرئيسية</SelectItem>
                  <SelectItem value="credit">آجل — على حساب المورد</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={f.vatApplicable}
                onCheckedChange={(c) => setF({ ...f, vatApplicable: c === true })}
              />
              خاضعة لضريبة القيمة المضافة ١٤٪
            </label>
          </div>

          <div className="grid grid-cols-2 gap-y-1 rounded-lg border border-dashed bg-muted/60 p-3 text-sm">
            <span className="text-muted-foreground">القيمة قبل الضريبة</span>
            <span className="num text-left">{egp(totals.subtotal)}</span>
            <span className="text-muted-foreground">ضريبة القيمة المضافة ١٤٪</span>
            <span className="num text-left text-copper">{egp(totals.vat)}</span>
            <span className="text-muted-foreground">إجمالي الفاتورة</span>
            <span className="num text-left">{egp(totals.total)}</span>
            <span className="text-muted-foreground">يُخصم: الخصم والتحصيل</span>
            <span className="num text-left text-primary">({egp(totals.wht)})</span>
            <span className="font-semibold">المدفوع للمورد</span>
            <span className="num text-left font-bold text-expense">{egp(totals.payable)}</span>
          </div>

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">{invoice ? "حفظ التعديلات" : f.terms === "credit" ? "حفظ على حساب المورد" : "حفظ وتسجيل بالخزينة"}</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reads supplier invoices (photos / PDFs) with Lovable AI and keeps them as drafts for review. */
function AiReadButton() {
  const { lists } = useHospitalDB();
  const canAdd = useCan("suppliers", "add");
  const read = useServerFn(readSupplierInvoice);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  if (!canAdd) return null;
  async function run(files: File[]) {
    setBusy(files.length);
    let ok = 0;
    for (const file of files) {
      const problem = aiFileProblem(file);
      if (problem) {
        toast.error(`${file.name}: ${problem}`);
        setBusy((n) => n - 1);
        continue;
      }
      try {
        const res = await read({
          data: {
            file: { fileName: file.name, mimeType: file.type, base64: await fileToBase64(file) },
            categories: lists.expenseCategories.map((c) => ({ id: c.id, name: c.name })),
          },
        });
        if (!res.ok) {
          toast.error(`${file.name}: ${res.error}`);
        } else {
          const r = res.result;
          if (
            saveInvoiceDraft({
              id: newId(),
              fileName: file.name,
              supplierName: r.supplierName || "مورد غير واضح",
              supplierTaxId: r.supplierTaxId?.replace(/\D/g, "") || undefined,
              supplierInvoiceNo: r.supplierInvoiceNo ?? undefined,
              date: r.date ?? undefined,
              subtotal: r.subtotal ?? undefined,
              vat: r.vat ?? undefined,
              total: r.total ?? undefined,
              vatApplicable: r.vatApplicable,
              whtType: r.whtType,
              category: r.categoryId ?? undefined,
              description: r.description,
              lines: r.lines,
              confidence: r.confidence,
              notes: r.notes ?? undefined,
            })
          )
            ok++;
        }
      } catch (e) {
        console.error(e);
        toast.error(`${file.name}: تعذّرت القراءة، حاول مرة أخرى.`);
      }
      setBusy((n) => n - 1);
    }
    setBusy(0);
    if (ok) toast.success(`تمت قراءة ${int(ok)} فاتورة — راجعها في المسودات وارحّلها.`);
  }
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void run(files.slice(0, 10));
        }}
      />
      <Button variant="outline" disabled={busy > 0} onClick={() => ref.current?.click()}>
        {busy > 0 ? <Sparkles className="animate-pulse" /> : <FileScan />}
        {busy > 0 ? `جارٍ القراءة (${int(busy)})...` : "قراءة فاتورة (صورة / PDF)"}
      </Button>
    </>
  );
}

function DraftsPanel({ onReview }: { onReview: (d: InvoiceDraft) => void }) {
  const { invoiceDrafts, lists } = useHospitalDB();
  if (!invoiceDrafts.length) return null;
  const tone = { high: "text-income", medium: "text-copper", low: "text-destructive" } as const;
  const label = { high: "قراءة واضحة", medium: "راجع الأرقام", low: "قراءة ضعيفة" } as const;
  return (
    <section className="ledger-card mb-6 overflow-hidden border-primary/30">
      <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-3">
        <Sparkles className="size-4 text-primary" />
        <h2 className="font-bold">مسودات من القراءة الذكية ({int(invoiceDrafts.length)})</h2>
        <p className="text-xs text-muted-foreground">لا تُسجَّل في الحسابات حتى تراجعها وتحفظها.</p>
      </div>
      <ul className="divide-y">
        {[...invoiceDrafts].sort((a, b) => b.createdAt - a.createdAt).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-48 flex-1">
              <p className="font-semibold">{d.supplierName}</p>
              <p className="text-[11px] text-muted-foreground">
                {d.fileName} • {d.date ? dateLabel(d.date) : "بدون تاريخ"}
                {d.supplierInvoiceNo && ` • رقم ${d.supplierInvoiceNo}`}
                {d.category && ` • ${listLabel(lists.expenseCategories, d.category)}`}
              </p>
              <p className="truncate text-xs">{d.description}</p>
            </div>
            <span className={cn("text-xs font-semibold", tone[d.confidence])}>{label[d.confidence]}</span>
            <span className="num w-32 text-left font-bold">{d.total != null ? egp(d.total) : "—"}</span>
            <Button size="sm" onClick={() => onReview(d)}>
              مراجعة وترحيل
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="حذف المسودة"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => window.confirm("حذف المسودة؟") && deleteInvoiceDraft(d.id)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
