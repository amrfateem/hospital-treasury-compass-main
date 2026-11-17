import { Banknote, Check, FileDown, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
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
  MethodSelect,
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
  decidePaymentOrder,
  deletePaymentOrder,
  findBox,
  listLabel,
  MAIN_BOX_ID,
  ORDER_STATUS_LABELS,
  payPaymentOrder,
  savePaymentOrder,
  unpayPaymentOrder,
  useCan,
  useCanApprove,
  useHospitalDB,
  type OrderStatus,
  type PaymentOrder,
} from "@/lib/hospital/store";

export function PaymentOrders() {
  const db = useHospitalDB();
  const canEdit = useCan("orders");
  const canAdd = useCan("orders", "add");
  const approver = useCanApprove();
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PaymentOrder | null | "new">(null);
  const [paying, setPaying] = useState<PaymentOrder | null>(null);
  const [printing, setPrinting] = useState<PaymentOrder | null>(null);
  const pdf = usePdfExport();

  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => {
      void pdf.run(`أمر-صرف-${printing.number}.pdf`, "تم تصدير أمر الصرف.").finally(() => setPrinting(null));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  const rows = useMemo(
    () =>
      db.paymentOrders
        .filter(
          (o) =>
            (status === "all" || o.status === status) &&
            matches(query, o.number, o.beneficiary, o.description),
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [db.paymentOrders, status, query],
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
            {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchBox value={query} onChange={setQuery} placeholder="رقم الأمر، المستفيد أو السبب" className="md:flex-1" />
        {canAdd && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> أمر صرف جديد
          </Button>
        )}
      </FilterBar>

      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>رقم الأمر</Th>
            <Th>التاريخ</Th>
            <Th>المستفيد</Th>
            <Th>البند / القسم</Th>
            <Th num>المبلغ</Th>
            <Th>الحالة</Th>
            <Th className="w-56" />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td className="font-mono text-xs">
                <span dir="ltr">{o.number}</span>
              </Td>
              <Td num className="text-right">
                {dateLabel(o.date)}
              </Td>
              <Td>
                <p className="font-medium">{o.beneficiary}</p>
                <p className="text-[11px] text-muted-foreground">{o.description}</p>
                <p className="text-[10px] text-muted-foreground">طلبه: {o.requestedBy}</p>
              </Td>
              <Td className="text-xs">
                <p className="mb-1">{listLabel(db.lists.expenseCategories, o.category)}</p>
                <DeptBadge id={o.department} />
              </Td>
              <Td num className="font-semibold">
                {money(o.amount)}
              </Td>
              <Td>
                <StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
                {o.decidedBy && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {o.status === "rejected" ? "رفضه" : "اعتمده"}: {o.decidedBy}
                    {o.decisionNote ? ` — ${o.decisionNote}` : ""}
                  </p>
                )}
                {o.status === "paid" && (
                  <p className="text-[10px] text-muted-foreground">
                    صُرف {o.paidOn ? dateLabel(o.paidOn) : ""} من {findBox(db, o.boxId).name}
                  </p>
                )}
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1">
                  {o.status === "pending" && approver(o) && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => decidePaymentOrder(o.id, true) && toast.success("تم اعتماد أمر الصرف.")}>
                        <Check /> اعتماد
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="رفض"
                        className="text-destructive"
                        onClick={() => {
                          const note = window.prompt("سبب الرفض:") ?? undefined;
                          if (note !== undefined && decidePaymentOrder(o.id, false, note)) toast.success("تم رفض أمر الصرف.");
                        }}
                      >
                        <X />
                      </Button>
                    </>
                  )}
                  {o.status === "approved" && canAdd && (
                    <Button size="sm" onClick={() => setPaying(o)}>
                      <Banknote /> صرف
                    </Button>
                  )}
                  {o.status === "paid" && canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="إلغاء الصرف"
                      title="إلغاء الصرف"
                      onClick={() => window.confirm("إلغاء صرف هذا الأمر وحذف المصروف من الخزينة؟") && unpayPaymentOrder(o.id)}
                    >
                      <Undo2 />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" aria-label="طباعة أمر الصرف" onClick={() => setPrinting(o)} disabled={pdf.busy}>
                    <FileDown />
                  </Button>
                  {o.status === "pending" && canEdit && (
                    <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setEditing(o)}>
                      <Pencil />
                    </Button>
                  )}
                  {o.status !== "paid" && canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="حذف"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => window.confirm(`حذف أمر الصرف ${o.number}؟`) && deletePaymentOrder(o.id)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={7} text="لا توجد أوامر صرف." />}
        </tbody>
      </TableCard>

      <OrderDialog
        open={editing !== null}
        order={editing === "new" ? null : editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <PayDialog order={paying} onClose={() => setPaying(null)} />

      {printing && (
        <OfficialDocument
          ref={pdf.ref}
          settings={db.settings}
          title="أمر صرف نقدية"
          subtitle={<span dir="ltr">{printing.number}</span>}
          issuedOn={dateLabel(printing.date)}
        >
          <DocInfoGrid
            items={[
              ["رقم الأمر", <span dir="ltr">{printing.number}</span>],
              ["التاريخ", dateLabel(printing.date)],
              ["المستفيد", printing.beneficiary],
              ["القسم", findDepartment(db.departments, printing.department).name],
              ["البند", listLabel(db.lists.expenseCategories, printing.category)],
              ["المبلغ", egp(printing.amount)],
              ["الحالة", ORDER_STATUS_LABELS[printing.status]],
              ["طالب الصرف", printing.requestedBy],
              ["المعتمد", printing.decidedBy ?? "—"],
              ["صُرف من", printing.status === "paid" ? findBox(db, printing.boxId).name : "—"],
            ]}
          />
          <p data-pdf-break style={{ fontSize: 13, margin: "12px 0" }}>
            <strong>سبب الصرف: </strong>
            {printing.description}
          </p>
          <SignatureBlock roles={["طالب الصرف", "المراجع الداخلي", "المدير المالي", "مدير المستشفى", "المستلم"]} />
        </OfficialDocument>
      )}
    </div>
  );
}

function OrderDialog({
  open,
  order,
  onOpenChange,
}: {
  open: boolean;
  order: PaymentOrder | null;
  onOpenChange: (o: boolean) => void;
}) {
  const db = useHospitalDB();
  const blank = () => ({
    date: order?.date ?? isoDate(new Date()),
    beneficiary: order?.beneficiary ?? "",
    department: order?.department ?? GENERAL_DEPT_ID,
    category: order?.category ?? db.lists.expenseCategories[0]?.id ?? "",
    description: order?.description ?? "",
    amount: order ? String(order.amount) : "",
  });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order]);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (savePaymentOrder({ ...f, amount: Number(f.amount) }, order)) {
      toast.success(order ? "تم تعديل أمر الصرف." : "تم إنشاء أمر الصرف — بانتظار الاعتماد.");
      onOpenChange(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{order ? "تعديل أمر صرف" : "أمر صرف جديد"}</DialogTitle>
          <DialogDescription>لا يُصرف أي مبلغ إلا بعد اعتماد الأمر من المختص.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="po-date">
              <Input id="po-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
            </FieldRow>
            <FieldRow label="المبلغ (ج.م)" htmlFor="po-amount">
              <Input id="po-amount" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </FieldRow>
          </div>
          <FieldRow label="المستفيد" htmlFor="po-ben">
            <Input id="po-ben" value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} placeholder="اسم الشخص أو الجهة" />
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="القسم">
              <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
            </FieldRow>
            <FieldRow label="البند">
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger aria-label="البند">
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
          <FieldRow label="سبب الصرف" htmlFor="po-desc">
            <Input id="po-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ order, onClose }: { order: PaymentOrder | null; onClose: () => void }) {
  const [date, setDate] = useState(isoDate(new Date()));
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const [method, setMethod] = useState("cash");
  useEffect(() => {
    if (order) {
      setDate(isoDate(new Date()));
      setBoxId(MAIN_BOX_ID);
      setMethod("cash");
    }
  }, [order]);
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">صرف أمر {order?.number}</DialogTitle>
          <DialogDescription>
            {order ? `${egp(order.amount)} إلى ${order.beneficiary} — يُسجَّل تلقائيًا كمصروف.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FieldRow label="تاريخ الصرف" htmlFor="pay-date">
            <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FieldRow>
          <FieldRow label="من خزينة">
            <BoxSelect value={boxId} onChange={setBoxId} />
          </FieldRow>
          <FieldRow label="طريقة الدفع">
            <MethodSelect value={method} onChange={setMethod} />
          </FieldRow>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            onClick={() => {
              if (order && payPaymentOrder(order.id, date, boxId, method)) {
                toast.success("تم الصرف وتسجيله في المصروفات.");
                onClose();
              }
            }}
          >
            <Banknote /> تأكيد الصرف
          </Button>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
