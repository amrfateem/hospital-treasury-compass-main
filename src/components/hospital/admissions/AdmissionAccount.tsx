import { BedDouble, LogOut, Pencil, Plus, Printer, RotateCcw, Search, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DeptBadge } from "@/components/hospital/ui";
import { DeptSelect, FieldRow, matches, MethodSelect, usePdfExport } from "@/components/hospital/kit";
import { ReceiptDocument } from "@/components/hospital/billing/ReceiptDocument";
import { servicesForDesk } from "@/lib/hospital/catalog";
import { findDepartment } from "@/lib/hospital/constants";
import { stockStatus } from "@/lib/hospital/finance";
import { dateLabel, egp, int, isoDate, money } from "@/lib/hospital/format";
import { admissionBill, depositsOf, dischargeSettlement } from "@/lib/hospital/inpatient";
import {
  addAdmissionCharge,
  addAdmissionDeposit,
  canSpendDirectly,
  deleteAdmissionDeposit,
  dischargeAdmission,
  listLabel,
  removeAdmissionCharge,
  reopenAdmission,
  updateAdmission,
  useCan,
  useHospitalDB,
  useHospitalSession,
  type Admission,
  type ServiceKind,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

interface Entry {
  key: string;
  name: string;
  price: number;
  group: string;
  kind?: ServiceKind | undefined;
  stockItemId?: string | undefined;
  balance?: number | undefined;
  unit?: string | undefined;
}

/** One inpatient account: deposits, every charge during the stay, and the discharge with its final bill. */
export function AdmissionAccount({ admissionId, onOpenChange }: { admissionId: string | null; onOpenChange: (o: boolean) => void }) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canAdd = useCan("billing", "add");
  const manager = !!me && canSpendDirectly(me);
  const adm = db.admissions.find((a) => a.id === admissionId) ?? null;
  const today = isoDate(new Date());

  return (
    <Dialog open={!!adm} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[94vh] overflow-y-auto sm:max-w-6xl">
        {adm && <Account adm={adm} today={today} canAdd={canAdd} manager={manager} />}
      </DialogContent>
    </Dialog>
  );
}

function Account({ adm, today, canAdd, manager }: { adm: Admission; today: string; canAdd: boolean; manager: boolean }) {
  const db = useHospitalDB();
  const open = adm.status === "open";
  const deposits = db.transactions.filter((t) => t.source === "deposit" && t.ref === adm.id);
  const depositTotal = depositsOf(db.transactions, adm.id);
  const [outDate, setOutDate] = useState(today < adm.date ? adm.date : today);
  const [discount, setDiscount] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const bill = admissionBill(adm, open ? outDate : (adm.dischargeDate ?? today), Number(discount) || 0);
  const s = dischargeSettlement(bill.patientShare, depositTotal, paid.trim() === "" ? undefined : Number(paid));
  const doctor = adm.doctorId ? db.doctors.find((d) => d.id === adm.doctorId)?.name : "";
  const invoice = adm.invoiceId ? db.patientInvoices.find((i) => i.id === adm.invoiceId) : undefined;
  const pdf = usePdfExport();
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => void pdf.run(`فاتورة-خروج-${adm.number}.pdf`, "تم تصدير الفاتورة النهائية.").finally(() => setPrinting(false)));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  function discharge() {
    if (s.error) { toast.error(s.error); return; }
    const msg =
      `خروج ${adm.patientName} بتاريخ ${dateLabel(outDate)}؟\n` +
      `إجمالي الحساب ${egp(bill.total)} — المطلوب من المريض ${egp(bill.patientShare)}\n` +
      `التأمين المدفوع ${egp(depositTotal)} — يُحصَّل الآن ${egp(s.payNow)}` +
      (s.remaining > 0 ? ` — يتبقى عليه ${egp(s.remaining)}` : "") +
      (s.refund > 0 ? `\nيُرد للمريض باقي التأمين ${egp(s.refund)}` : "");
    if (!window.confirm(msg)) return;
    const id = dischargeAdmission({ admissionId: adm.id, dischargeDate: outDate, discount: Number(discount) || 0, paid: paid.trim() === "" ? undefined : Number(paid), paymentMethod: method });
    if (id) toast.success("تم خروج المريض وإصدار الفاتورة النهائية وتسجيلها بالخزينة.");
  }

  return (
    <>
      <DialogHeader className="text-right sm:text-right">
        <DialogTitle className="flex flex-wrap items-center gap-2 font-display text-2xl">
          <BedDouble className="size-6 text-primary" /> {adm.patientName}
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", open ? "bg-income/10 text-income" : "bg-muted text-muted-foreground")}>
            {open ? "مقيم حاليًا" : `خرج ${dateLabel(adm.dischargeDate ?? "")}`}
          </span>
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span dir="ltr" className="num">{adm.number}</span>
          {adm.patientMrn && <span>ملف <span dir="ltr" className="num">{adm.patientMrn}</span></span>}
          <DeptBadge id={adm.ward} />
          {adm.room && <span>غرفة {adm.room}</span>}
          {doctor && <span>د. {doctor}</span>}
          <span>دخل {dateLabel(adm.date)} — <b className="num">{int(bill.days)}</b> يوم</span>
          {adm.payer && <span>{listLabel(db.lists.payers, adm.payer.payerId)} {int(adm.payer.percent)}٪</span>}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-4">
          {open && canAdd && <AddCharge adm={adm} today={today} />}
          <section className="rounded-lg border">
            <h3 className="border-b bg-secondary/60 px-3 py-2 text-sm font-semibold">بنود الحساب ({int(adm.charges.length + 1)})</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <tbody>
                  <tr className="border-b bg-muted/40">
                    <td className="px-3 py-2 text-xs text-muted-foreground">من {dateLabel(adm.date)}</td>
                    <td className="px-3 py-2">إقامة {money(adm.roomRate)} + إشراف {money(adm.supervisionRate)} يوميًا</td>
                    <td className="num px-3 py-2 text-left">{int(bill.days)} يوم</td>
                    <td className="num px-3 py-2 text-left font-semibold">{money(bill.room + bill.supervision)}</td>
                    <td />
                  </tr>
                  {[...adm.charges].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt).map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-xs text-muted-foreground">{dateLabel(c.date)}</td>
                      <td className="px-3 py-2">
                        {c.description}
                        <span className="mr-1.5 text-[11px] text-muted-foreground">— {findDepartment(db.departments, c.department).name}{c.stockItemId ? " (من المخزن)" : ""}</span>
                      </td>
                      <td className="num px-3 py-2 text-left">{int(c.qty)} × {money(c.unitPrice)}</td>
                      <td className="num px-3 py-2 text-left font-semibold">{money(c.qty * c.unitPrice)}</td>
                      <td className="w-10 px-1">
                        {open && canAdd && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive"
                            aria-label={`حذف ${c.description}`}
                            onClick={() => window.confirm(`حذف «${c.description}» من الحساب؟`) && removeAdmissionCharge(adm.id, c.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {open && canAdd && <StayEditor adm={adm} />}
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-dashed bg-muted/60 p-3 text-sm">
            <div className="grid grid-cols-2 gap-y-1">
              <span className="text-muted-foreground">الإقامة والإشراف</span>
              <span className="num text-left">{egp(bill.room + bill.supervision)}</span>
              <span className="text-muted-foreground">الخدمات والأدوية</span>
              <span className="num text-left">{egp(bill.items)}</span>
              {bill.discount > 0 && (
                <>
                  <span className="text-muted-foreground">الخصم</span>
                  <span className="num text-left text-expense">{egp(bill.discount)}</span>
                </>
              )}
              <span className="font-semibold">إجمالي الحساب</span>
              <span className="num text-left font-bold">{egp(bill.total)}</span>
              {bill.insurerShare > 0 && (
                <>
                  <span className="text-muted-foreground">على جهة التعاقد</span>
                  <span className="num text-left">{egp(bill.insurerShare)}</span>
                </>
              )}
              <span className="text-muted-foreground">المطلوب من المريض</span>
              <span className="num text-left">{egp(bill.patientShare)}</span>
              <span className="text-muted-foreground">التأمين المدفوع</span>
              <span className="num text-left text-income">{egp(depositTotal)}</span>
              {open ? (
                <>
                  <span className="font-semibold">{bill.patientShare >= depositTotal ? "الباقي على المريض" : "زيادة تأمين تُرد له"}</span>
                  <span className={cn("num text-left text-lg font-bold", bill.patientShare >= depositTotal ? "text-expense" : "text-income")}>
                    {egp(Math.abs(bill.patientShare - depositTotal))}
                  </span>
                </>
              ) : (
                invoice && (
                  <>
                    <span className="text-muted-foreground">دُفع عند الخروج</span>
                    <span className="num text-left">{egp(Math.max(0, bill.patientShare - (invoice.depositApplied ?? 0) - (invoice.credit?.amount ?? 0)))}</span>
                    <span className="font-semibold">متبقٍ على المريض</span>
                    <span className="num text-left font-bold text-expense">{egp(invoice.credit?.amount ?? 0)}</span>
                  </>
                )
              )}
            </div>
            {open && <p className="mt-2 text-[11px] text-muted-foreground">الحساب محسوب حتى تاريخ الخروج المختار أدناه.</p>}
          </section>

          <Deposits adm={adm} deposits={deposits} canAdd={canAdd && open} manager={manager && open} />

          {open && canAdd && (
            <section className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><LogOut className="size-4" /> خروج المريض والفاتورة النهائية</h3>
              <div className="grid grid-cols-2 gap-2">
                <FieldRow label="تاريخ الخروج" htmlFor="dc-date">
                  <Input id="dc-date" type="date" min={adm.date} value={outDate} onChange={(e) => setOutDate(e.target.value)} className="bg-card" />
                </FieldRow>
                <FieldRow label="خصم (ج.م)" htmlFor="dc-disc">
                  <Input id="dc-disc" type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} className="bg-card" />
                </FieldRow>
                <FieldRow label="المدفوع الآن" htmlFor="dc-paid">
                  <Input id="dc-paid" type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={`كامل ${money(s.due)}`} className="bg-card" />
                </FieldRow>
                <FieldRow label="طريقة الدفع">
                  <MethodSelect value={method} onChange={setMethod} />
                </FieldRow>
              </div>
              {s.remaining > 0 && <p className="text-xs text-expense">يتبقى على المريض {egp(s.remaining)} — يظهر في ملفه ويُحصَّل لاحقًا.</p>}
              {s.refund > 0 && <p className="text-xs text-income">يُرد للمريض باقي التأمين {egp(s.refund)} من الخزينة الرئيسية.</p>}
              {s.error && <p className="text-xs font-medium text-destructive">{s.error}</p>}
              <Button onClick={discharge} disabled={!!s.error}>
                <LogOut /> خروج وإصدار الفاتورة النهائية
              </Button>
            </section>
          )}

          {!open && (
            <section className="grid gap-2 rounded-lg border p-3 text-sm">
              <p>
                الفاتورة النهائية: <span dir="ltr" className="num font-semibold">{invoice?.number ?? "—"}</span>
              </p>
              {invoice && (
                <Button variant="secondary" onClick={() => setPrinting(true)} disabled={printing}>
                  <Printer /> طباعة الفاتورة النهائية A4
                </Button>
              )}
              {manager && (
                <Button
                  variant="ghost"
                  onClick={() => window.confirm("إعادة فتح الحساب؟ ستُلغى الفاتورة النهائية وقيدها لتعديل الحساب ثم الخروج من جديد.") && reopenAdmission(adm.id) && toast.success("أُعيد فتح الحساب.")}
                >
                  <RotateCcw /> إعادة فتح الحساب
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>
      {printing && invoice && <ReceiptDocument ref={pdf.ref} db={db} invoice={invoice} format="a4" />}
    </>
  );
}

function Deposits({ adm, deposits, canAdd, manager }: { adm: Admission; deposits: ReturnType<typeof useHospitalDB>["transactions"]; canAdd: boolean; manager: boolean }) {
  const db = useHospitalDB();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  return (
    <section className="rounded-lg border p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Wallet className="size-4" /> التأمين المدفوع</h3>
      <ul className="grid gap-1 text-sm">
        {deposits.map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1">
            <span className="text-xs text-muted-foreground">{dateLabel(t.date)}</span>
            <span className="flex-1 truncate text-xs">{t.kind === "out" ? "رد باقي التأمين" : listLabel(db.lists.paymentMethods, t.method ?? "cash")}</span>
            <span className={cn("num font-semibold", t.kind === "out" ? "text-expense" : "text-income")}>{t.kind === "out" ? "-" : ""}{money(t.amount)}</span>
            {manager && t.kind === "in" && (
              <Button variant="ghost" size="icon" className="size-6 text-destructive" aria-label="حذف التأمين" onClick={() => window.confirm("حذف هذا التأمين من الخزينة؟") && deleteAdmissionDeposit(t.id)}>
                <Trash2 className="size-3" />
              </Button>
            )}
          </li>
        ))}
        {!deposits.length && <li className="text-xs text-muted-foreground">لم يُدفع تأمين بعد.</li>}
      </ul>
      {canAdd && (
        <form
          className="mt-2 grid grid-cols-[1fr_8rem_auto] gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!(Number(amount) > 0)) { toast.error("اكتب مبلغ التأمين."); return; }
            if (addAdmissionDeposit({ admissionId: adm.id, date: isoDate(new Date()), amount: Number(amount), method })) {
              toast.success("تم تسجيل التأمين بالخزينة.");
              setAmount("");
            }
          }}
        >
          <Input aria-label="مبلغ تأمين إضافي" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="تأمين إضافي" className="h-8" />
          <MethodSelect value={method} onChange={setMethod} className="h-8" />
          <Button type="submit" size="sm" className="h-8"><Plus /> إضافة</Button>
        </form>
      )}
    </section>
  );
}

function StayEditor({ adm }: { adm: Admission }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ward: adm.ward, room: adm.room ?? "", roomRate: String(adm.roomRate), supervisionRate: String(adm.supervisionRate) });
  useEffect(() => setF({ ward: adm.ward, room: adm.room ?? "", roomRate: String(adm.roomRate), supervisionRate: String(adm.supervisionRate) }), [adm]);
  if (!open)
    return (
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setOpen(true)}>
        <Pencil /> تعديل القسم أو الغرفة أو أسعار الإقامة
      </Button>
    );
  return (
    <form
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (updateAdmission(adm.id, { ward: f.ward, room: f.room.trim() || undefined, doctorId: adm.doctorId, payer: adm.payer, roomRate: Number(f.roomRate) || 0, supervisionRate: Number(f.supervisionRate) || 0, notes: adm.notes })) {
          toast.success("تم تعديل بيانات الإقامة.");
          setOpen(false);
        }
      }}
    >
      <FieldRow label="القسم"><DeptSelect value={f.ward} onChange={(v) => setF({ ...f, ward: v })} /></FieldRow>
      <FieldRow label="الغرفة" htmlFor="se-room"><Input id="se-room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></FieldRow>
      <FieldRow label="سعر اليوم" htmlFor="se-rr"><Input id="se-rr" type="number" min="0" value={f.roomRate} onChange={(e) => setF({ ...f, roomRate: e.target.value })} /></FieldRow>
      <FieldRow label="الإشراف / يوم" htmlFor="se-sr"><Input id="se-sr" type="number" min="0" value={f.supervisionRate} onChange={(e) => setF({ ...f, supervisionRate: e.target.value })} /></FieldRow>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" size="sm">حفظ</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
      </div>
    </form>
  );
}

/** Adds a service or a drug to the account from the chosen department's own price list. */
function AddCharge({ adm, today }: { adm: Admission; today: string }) {
  const db = useHospitalDB();
  const [dept, setDept] = useState("lab");
  const [q, setQ] = useState("");
  const [qty, setQty] = useState("1");
  const [manual, setManual] = useState({ description: "", price: "" });
  const entries = useMemo<Entry[]>(() => {
    const { own, shared } = servicesForDesk(db.lists.services, { department: dept, stay: true });
    const list: Entry[] = own.map((s) => ({ key: s.id, name: s.name, price: s.price, group: s.group ?? "خدمات القسم", kind: s.kind }));
    if (dept === "pharmacy")
      for (const i of db.stockItems.filter((x) => x.department === "pharmacy" && x.active))
        list.unshift({
          key: i.id,
          name: i.name,
          price: i.salePrice ?? 0,
          group: db.lists.stockCategories.find((c) => c.id === i.category)?.name ?? "أصناف الصيدلية",
          stockItemId: i.id,
          unit: i.unit,
          balance: stockStatus(i, db.stockMoves, today).balance,
        });
    for (const s of shared) list.push({ key: s.id, name: s.name, price: s.price, group: "خدمات عامة", kind: s.kind });
    return list;
  }, [db.lists, db.stockItems, db.stockMoves, dept, today]);
  const shown = entries.filter((e) => matches(q, e.name, e.group)).slice(0, 60);
  const n = Math.max(1, Math.floor(Number(qty) || 1));

  function add(e: Entry) {
    if (!(e.price > 0)) { toast.error(`«${e.name}» بدون سعر — حدده من صفحة الخدمات أو المخزن، أو أضفه كسطر يدوي.`); return; }
    if (addAdmissionCharge(adm.id, { date: today < adm.date ? adm.date : today, department: dept, description: e.name, qty: n, unitPrice: e.price, kind: e.kind, stockItemId: e.stockItemId }))
      toast.success(`أُضيف «${e.name}» على حساب المريض.`);
  }

  return (
    <section className="rounded-lg border bg-muted/30 p-3">
      <h3 className="mb-2 text-sm font-semibold">إضافة خدمة أو دواء على الحساب</h3>
      <div className="grid gap-2 sm:grid-cols-[14rem_1fr_5rem]">
        <DeptSelect value={dept} onChange={(v) => { setDept(v); setQ(""); }} label="القسم المقدم للخدمة" />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في خدمات القسم..." className="pr-8" aria-label="بحث في خدمات القسم" />
        </div>
        <Input aria-label="الكمية" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <div className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {shown.map((e) => (
          <button key={e.key} type="button" onClick={() => add(e)} className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5 text-right text-sm hover:border-primary">
            <span className="min-w-0">
              <span className="block truncate">{e.name}</span>
              <span className="block text-[10px] text-muted-foreground">
                {e.group}
                {e.stockItemId && <span className={cn("mr-1", (e.balance ?? 0) > 0 ? "" : "text-destructive")}> — متاح {int(e.balance ?? 0)} {e.unit}</span>}
              </span>
            </span>
            <span className="num shrink-0 text-xs text-muted-foreground">{e.price ? money(e.price) : "بدون سعر"}</span>
          </button>
        ))}
        {!shown.length && <p className="col-span-full py-4 text-center text-xs text-muted-foreground">لا توجد خدمات مسعّرة لهذا القسم — أضف سطرًا يدويًا.</p>}
      </div>
      <form
        className="mt-2 grid grid-cols-[1fr_7rem_auto] gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!manual.description.trim() || !(Number(manual.price) > 0)) { toast.error("اكتب البيان والسعر."); return; }
          if (addAdmissionCharge(adm.id, { date: today < adm.date ? adm.date : today, department: dept, description: manual.description.trim(), qty: n, unitPrice: Number(manual.price) })) {
            setManual({ description: "", price: "" });
            toast.success("أُضيف السطر على الحساب.");
          }
        }}
      >
        <Input aria-label="بيان سطر يدوي" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} placeholder="سطر يدوي (بيان)" className="h-8" />
        <Input aria-label="سعر السطر اليدوي" type="number" min="0" value={manual.price} onChange={(e) => setManual({ ...manual, price: e.target.value })} placeholder="السعر" className="h-8" />
        <Button type="submit" size="sm" variant="secondary" className="h-8"><Plus /> سطر</Button>
      </form>
    </section>
  );
}
