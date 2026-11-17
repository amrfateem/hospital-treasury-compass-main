import { Ban, Check, FileDown, PackageCheck, Pencil, Plus, Trash2, X } from "lucide-react";
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
import { DeptBadge } from "@/components/hospital/ui";
import {
  BoxSelect,
  DeptSelect,
  DocInfoGrid,
  EmptyRow,
  FieldRow,
  FilterBar,
  HeadRow,
  matches,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { StatusBadge } from "./StatusBadge";
import { findDepartment, GENERAL_DEPT_ID } from "@/lib/hospital/constants";
import { dateLabel, egp, isoDate, money } from "@/lib/hospital/format";
import {
  cancelPurchaseOrder,
  decidePurchaseOrder,
  deletePurchaseOrder,
  listLabel,
  MAIN_BOX_ID,
  newId,
  PURCHASE_STATUS_LABELS,
  receivePurchaseOrder,
  savePurchaseOrder,
  useCan,
  useCanApprove,
  useHospitalDB,
  type PurchaseOrder,
  type PurchaseStatus,
} from "@/lib/hospital/store";

const total = (po: PurchaseOrder) => po.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

export function PurchaseOrders() {
  const db = useHospitalDB();
  const canEdit = useCan("orders");
  const canAdd = useCan("orders", "add");
  const approver = useCanApprove();
  const [status, setStatus] = useState<"all" | PurchaseStatus>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PurchaseOrder | null | "new">(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [printing, setPrinting] = useState<PurchaseOrder | null>(null);
  const pdf = usePdfExport();

  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => {
      void pdf.run(`طلبية-${printing.number}.pdf`, "تم تصدير الطلبية.").finally(() => setPrinting(null));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  const rows = useMemo(
    () =>
      db.purchaseOrders
        .filter((o) => (status === "all" || o.status === status) && matches(query, o.number, o.supplierName, ...o.lines.map((l) => l.description)))
        .sort((a, b) => b.createdAt - a.createdAt),
    [db.purchaseOrders, status, query],
  );

  return (
    <div>
      <FilterBar>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="bg-card md:w-56" aria-label="الحالة">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الحالات</SelectItem>
            {(Object.keys(PURCHASE_STATUS_LABELS) as PurchaseStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {PURCHASE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchBox value={query} onChange={setQuery} placeholder="رقم الطلبية، المورد أو الصنف" className="md:flex-1" />
        {canAdd && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> طلبية جديدة
          </Button>
        )}
      </FilterBar>

      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>رقم الطلبية</Th>
            <Th>التاريخ</Th>
            <Th>المورد</Th>
            <Th>الأصناف</Th>
            <Th num>القيمة</Th>
            <Th>الحالة</Th>
            <Th className="w-56" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-b align-top last:border-0 hover:bg-muted/50">
              <Td className="font-mono text-xs">
                <span dir="ltr">{o.number}</span>
              </Td>
              <Td num className="text-right">
                {dateLabel(o.date)}
              </Td>
              <Td>
                <p className="font-medium">{o.supplierName}</p>
                <DeptBadge id={o.department} />
              </Td>
              <Td className="text-xs">
                <ul className="space-y-0.5">
                  {o.lines.map((l) => (
                    <li key={l.id}>
                      {l.description} —{" "}
                      <span className="num">
                        {l.received}/{l.qty}
                      </span>
                    </li>
                  ))}
                </ul>
                {o.receipts.length > 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    أذون استلام: {o.receipts.map((r) => r.number).join("، ")}
                  </p>
                )}
              </Td>
              <Td num className="font-semibold">
                {money(total(o))}
              </Td>
              <Td>
                <StatusBadge status={o.status} label={PURCHASE_STATUS_LABELS[o.status]} />
                {o.decidedBy && <p className="mt-1 text-[10px] text-muted-foreground">بواسطة: {o.decidedBy}</p>}
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1">
                  {o.status === "pending" && approver(o) && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => decidePurchaseOrder(o.id, true) && toast.success("تم اعتماد الطلبية.")}>
                        <Check /> اعتماد
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="رفض" className="text-destructive" onClick={() => window.confirm("رفض الطلبية؟") && decidePurchaseOrder(o.id, false)}>
                        <X />
                      </Button>
                    </>
                  )}
                  {(o.status === "approved" || o.status === "partial") && canAdd && (
                    <Button size="sm" onClick={() => setReceiving(o)}>
                      <PackageCheck /> استلام
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" aria-label="طباعة" onClick={() => setPrinting(o)} disabled={pdf.busy}>
                    <FileDown />
                  </Button>
                  {o.status === "pending" && canEdit && (
                    <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setEditing(o)}>
                      <Pencil />
                    </Button>
                  )}
                  {o.status === "approved" && !o.receipts.length && canEdit && (
                    <Button size="icon" variant="ghost" aria-label="إلغاء الطلبية" title="إلغاء الطلبية" onClick={() => window.confirm("إلغاء الطلبية؟") && cancelPurchaseOrder(o.id)}>
                      <Ban />
                    </Button>
                  )}
                  {!o.receipts.length && o.status !== "approved" && canEdit && (
                    <Button size="icon" variant="ghost" aria-label="حذف" className="text-muted-foreground hover:text-destructive" onClick={() => window.confirm(`حذف الطلبية ${o.number}؟`) && deletePurchaseOrder(o.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={7} text="لا توجد طلبيات." />}
        </tbody>
      </TableCard>

      <PODialog open={editing !== null} po={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ReceiveDialog po={receiving} onClose={() => setReceiving(null)} />

      {printing && (
        <OfficialDocument ref={pdf.ref} settings={db.settings} title="طلبية شراء (أمر توريد)" subtitle={<span dir="ltr">{printing.number}</span>} issuedOn={dateLabel(printing.date)}>
          <DocInfoGrid
            items={[
              ["المورد", printing.supplierName],
              ["القسم الطالب", findDepartment(db.departments, printing.department).name],
              ["البند", listLabel(db.lists.expenseCategories, printing.category)],
              ["الحالة", PURCHASE_STATUS_LABELS[printing.status]],
              ["طلبها", printing.requestedBy],
              ["اعتمدها", printing.decidedBy ?? "—"],
            ]}
          />
          <table className="doc-table">
            <thead>
              <tr data-pdf-break>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>الإجمالي</th>
                <th>المستلم</th>
              </tr>
            </thead>
            <tbody>
              {printing.lines.map((l) => (
                <tr key={l.id} data-pdf-break>
                  <td className="text-start">{l.description}</td>
                  <td>{l.qty}</td>
                  <td>{money(l.unitPrice)}</td>
                  <td>{money(l.qty * l.unitPrice)}</td>
                  <td>{l.received}</td>
                </tr>
              ))}
              <tr className="doc-total" data-pdf-break>
                <td colSpan={3} className="text-start">
                  الإجمالي
                </td>
                <td>{money(total(printing))}</td>
                <td />
              </tr>
            </tbody>
          </table>
          {printing.notes && <p data-pdf-break style={{ fontSize: 12.5, marginTop: 10 }}>ملاحظات: {printing.notes}</p>}
          <SignatureBlock roles={["مسؤول المشتريات", "أمين المخزن", "المراجع الداخلي", "مدير المستشفى"]} />
        </OfficialDocument>
      )}
    </div>
  );
}

type LineDraft = { id: string; stockItemId: string; description: string; qty: string; unitPrice: string };
const emptyLine = (): LineDraft => ({ id: newId(), stockItemId: "", description: "", qty: "1", unitPrice: "" });

function PODialog({ open, po, onOpenChange }: { open: boolean; po: PurchaseOrder | null; onOpenChange: (o: boolean) => void }) {
  const db = useHospitalDB();
  const [f, setF] = useState({ date: "", supplierName: "", department: GENERAL_DEPT_ID, category: "", notes: "" });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  useEffect(() => {
    if (!open) return;
    setF({
      date: po?.date ?? isoDate(new Date()),
      supplierName: po?.supplierName ?? "",
      department: po?.department ?? "purchasing",
      category: po?.category ?? db.lists.expenseCategories[0]?.id ?? "",
      notes: po?.notes ?? "",
    });
    setLines(
      po?.lines.map((l) => ({ id: l.id, stockItemId: l.stockItemId ?? "", description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice) })) ?? [emptyLine()],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po]);
  const suppliers = useMemo(
    () => [...new Set([...db.supplierInvoices.map((i) => i.supplierName), ...db.purchaseOrders.map((o) => o.supplierName)])].filter(Boolean),
    [db.supplierInvoices, db.purchaseOrders],
  );
  const sum = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const setLine = (id: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = savePurchaseOrder(
      {
        ...f,
        department: db.departments.some((d) => d.id === f.department) ? f.department : GENERAL_DEPT_ID,
        lines: lines.map((l) => ({
          id: l.id,
          stockItemId: l.stockItemId || undefined,
          description: l.description,
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unitPrice) || 0,
        })),
      },
      po,
    );
    if (ok) {
      toast.success(po ? "تم تعديل الطلبية." : "تم إنشاء الطلبية — بانتظار الاعتماد.");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{po ? "تعديل طلبية" : "طلبية شراء جديدة"}</DialogTitle>
          <DialogDescription>بعد الاعتماد يتم الاستلام على المخزن وتسجيل فاتورة المورد.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="pu-date">
              <Input id="pu-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            </FieldRow>
            <FieldRow label="المورد" htmlFor="pu-sup">
              <Input id="pu-sup" list="pu-suppliers" value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} />
              <datalist id="pu-suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </FieldRow>
            <FieldRow label="القسم الطالب">
              <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
            </FieldRow>
            <FieldRow label="بند المصروف">
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger aria-label="بند المصروف">
                  <SelectValue />
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
          </div>

          <div className="rounded-lg border">
            <div className="grid grid-cols-[1fr_5rem_6rem_2.5rem] gap-2 border-b bg-secondary/60 px-3 py-2 text-xs font-semibold">
              <span>الصنف</span>
              <span>الكمية</span>
              <span>سعر الوحدة</span>
              <span />
            </div>
            {lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_5rem_6rem_2.5rem] items-center gap-2 border-b px-3 py-2 last:border-0">
                <div className="grid gap-1">
                  <Select
                    value={l.stockItemId || "free"}
                    onValueChange={(v) =>
                      setLine(l.id, v === "free" ? { stockItemId: "" } : { stockItemId: v, description: db.stockItems.find((i) => i.id === v)?.name ?? "" })
                    }
                  >
                    <SelectTrigger aria-label="صنف المخزن" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="free">بند حر (ليس صنف مخزني)</SelectItem>
                      {db.stockItems
                        .filter((i) => i.active)
                        .map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name} ({i.unit})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {!l.stockItemId && (
                    <Input className="h-8 text-xs" placeholder="وصف البند" value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} aria-label="وصف البند" />
                  )}
                </div>
                <Input className="h-8" type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} aria-label="الكمية" />
                <Input className="h-8" type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(l.id, { unitPrice: e.target.value })} aria-label="سعر الوحدة" />
                <Button type="button" size="icon" variant="ghost" aria-label="حذف السطر" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus /> سطر جديد
              </Button>
              <span className="text-sm font-semibold">الإجمالي: {egp(sum)}</span>
            </div>
          </div>
          <FieldRow label="ملاحظات (اختياري)" htmlFor="pu-notes">
            <Input id="pu-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ الطلبية</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ po, onClose }: { po: PurchaseOrder | null; onClose: () => void }) {
  const [date, setDate] = useState(isoDate(new Date()));
  const [qty, setQty] = useState<Record<string, { qty: string; batchNo: string; expiry: string }>>({});
  const [payment, setPayment] = useState<"credit" | "cash" | "none">("credit");
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [invNo, setInvNo] = useState("");
  useEffect(() => {
    if (!po) return;
    setDate(isoDate(new Date()));
    setQty(Object.fromEntries(po.lines.map((l) => [l.id, { qty: String(Math.max(0, l.qty - l.received)), batchNo: "", expiry: "" }])));
    setPayment("credit");
    setBoxId(MAIN_BOX_ID);
    setInvNo("");
  }, [po]);
  if (!po) return null;
  const value = po.lines.reduce((s, l) => s + (Number(qty[l.id]?.qty) || 0) * l.unitPrice, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">استلام طلبية {po.number}</DialogTitle>
          <DialogDescription>الأصناف المخزنية تُضاف للمخزن تلقائيًا، ويمكن تسجيل فاتورة المورد آجلة أو نقدية.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FieldRow label="تاريخ الاستلام" htmlFor="rc-date">
            <Input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FieldRow>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b bg-secondary/60 text-xs">
                  <th className="px-3 py-2 text-right">الصنف</th>
                  <th className="px-3 py-2 text-right">المتبقي</th>
                  <th className="px-3 py-2 text-right">المستلم الآن</th>
                  <th className="px-3 py-2 text-right">رقم التشغيلة</th>
                  <th className="px-3 py-2 text-right">تاريخ الصلاحية</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => {
                  const left = Math.max(0, l.qty - l.received);
                  const v = qty[l.id] ?? { qty: "", batchNo: "", expiry: "" };
                  const set = (p: Partial<typeof v>) => setQty((q) => ({ ...q, [l.id]: { ...v, ...p } }));
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {l.description}
                        {!l.stockItemId && <span className="block text-[10px] text-muted-foreground">بند حر — لا يدخل المخزن</span>}
                      </td>
                      <td className="num px-3 py-2">{left}</td>
                      <td className="px-3 py-2">
                        <Input className="h-8 w-24" type="number" min="0" max={left} step="any" value={v.qty} onChange={(e) => set({ qty: e.target.value })} disabled={!left} aria-label="الكمية المستلمة" />
                      </td>
                      <td className="px-3 py-2">
                        <Input className="h-8 w-28" value={v.batchNo} onChange={(e) => set({ batchNo: e.target.value })} disabled={!l.stockItemId || !left} aria-label="رقم التشغيلة" />
                      </td>
                      <td className="px-3 py-2">
                        <Input className="h-8 w-36" type="date" value={v.expiry} onChange={(e) => set({ expiry: e.target.value })} disabled={!l.stockItemId || !left} aria-label="تاريخ الصلاحية" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow label="فاتورة المورد">
              <Select value={payment} onValueChange={(v) => setPayment(v as typeof payment)}>
                <SelectTrigger aria-label="فاتورة المورد">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="credit">آجلة على حساب المورد</SelectItem>
                  <SelectItem value="cash">نقدية — تُصرف الآن (مصروف)</SelectItem>
                  <SelectItem value="none">بدون فاتورة الآن</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            {payment === "cash" && (
              <FieldRow label="من خزينة">
                <BoxSelect value={boxId} onChange={setBoxId} />
              </FieldRow>
            )}
            {payment !== "none" && (
              <FieldRow label="رقم فاتورة المورد" htmlFor="rc-inv">
                <Input id="rc-inv" value={invNo} onChange={(e) => setInvNo(e.target.value)} />
              </FieldRow>
            )}
          </div>
          <p className="text-sm font-semibold">قيمة المستلم: {egp(value)}</p>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            onClick={() => {
              const ok = receivePurchaseOrder({
                poId: po.id,
                date,
                payment,
                boxId,
                supplierInvoiceNo: invNo,
                lines: po.lines.map((l) => ({
                  lineId: l.id,
                  qty: Number(qty[l.id]?.qty) || 0,
                  batchNo: qty[l.id]?.batchNo,
                  expiry: qty[l.id]?.expiry,
                })),
              });
              if (ok) {
                toast.success("تم تسجيل الاستلام.");
                onClose();
              }
            }}
          >
            <PackageCheck /> تأكيد الاستلام
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
