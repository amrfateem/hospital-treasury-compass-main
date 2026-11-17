import { FolderOpen, Loader2, Minus, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { findPatientsForBilling, openPatientFromBilling, type PatientRefLite } from "@/lib/medical/medical.functions";
import { getPatientMoney } from "@/lib/medical/patient-money.functions";
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
import { Textarea } from "@/components/ui/textarea";
import { DeptSelect, FieldRow, matches } from "@/components/hospital/kit";
import { isBank, boxForDepartment, findBox } from "@/lib/hospital/model";
import { isDeskRole } from "@/lib/hospital/permissions";
import { CLINICAL_GROUPS, findDepartment } from "@/lib/hospital/constants";
import {
  deskOf,
  findDeskService,
  RECEIPT_DESKS,
  servicesForDesk,
  stayRates,
  type ReceiptDeskKey,
} from "@/lib/hospital/catalog";
import { egp, int, isoDate, money } from "@/lib/hospital/format";
import { invoiceAmounts, remainingAfterPayment, stockStatus } from "@/lib/hospital/finance";
import { addMonths, makeInstallments } from "@/lib/hospital/credit";
import {
  savePatientInvoice,
  useCan,
  useHospitalDB,
  useHospitalSession,
  type PatientInvoice,
  type ServiceItem,
  type ServiceKind,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";
import { DESK_ICONS } from "./desks";

type ItemDraft = { description: string; qty: string; unitPrice: string; kind?: ServiceKind | undefined; stockItemId?: string | undefined };
/** A price-list entry; pharmacy entries are store items (sold out of stock). */
type CatalogEntry = ServiceItem & { stockItemId?: string | undefined; balance?: number | undefined; unit?: string | undefined };
const emptyItem = (): ItemDraft => ({ description: "", qty: "1", unitPrice: "" });
const NONE = "__none__";
const SHARED = "__shared__";
const SHARED_LABEL = "خدمات عامة";

export function InvoiceDialog({
  open,
  onOpenChange,
  invoice,
  defaultDesk,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoice: PatientInvoice | null;
  defaultDesk: ReceiptDeskKey;
  onSaved: (inv: PatientInvoice, isEdit: boolean) => void;
}) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const { lists, departments, doctors } = db;
  const canManual = useCan("settings", "edit");
  const picksBank = !!me && !isDeskRole(me.role);
  const [bankId, setBankId] = useState("");
  const [deskKey, setDeskKey] = useState<ReceiptDeskKey>(defaultDesk);
  /** "Other departments" desk: empty until the user picks the department. */
  const [otherDept, setOtherDept] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patient, setPatient] = useState<{ id: string; mrn: string } | null>(null);
  const [suggestions, setSuggestions] = useState<PatientRefLite[]>([]);
  const [prevRemaining, setPrevRemaining] = useState(0);
  /** What the patient pays at the desk now; empty = the full amount. The remainder is computed. */
  const [paid, setPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [doctorId, setDoctorId] = useState(NONE);
  const [anesthetistId, setAnesthetistId] = useState(NONE);
  const [clinicId, setClinicId] = useState(NONE);
  const [referredBy, setReferredBy] = useState("");
  const [payerId, setPayerId] = useState(NONE);
  const [payerPct, setPayerPct] = useState("");
  const [creditId, setCreditId] = useState(NONE);
  const [creditAmt, setCreditAmt] = useState("");
  const [creditCount, setCreditCount] = useState("1");
  const [creditFirst, setCreditFirst] = useState("");
  const [stay, setStay] = useState({ admitDate: "", dischargeDate: "", room: "", roomRate: "", supervisionRate: "" });
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogGroup, setCatalogGroup] = useState("all");
  const [error, setError] = useState("");

  const desk = RECEIPT_DESKS.find((d) => d.key === deskKey)!;
  const department = desk.deptId ?? otherDept;

  function stayDefaults(dept: string) {
    const r = stayRates(lists.services, dept);
    const today = isoDate(new Date());
    return {
      admitDate: today,
      dischargeDate: today,
      room: "",
      roomRate: r.roomRate ? String(r.roomRate) : "",
      supervisionRate: r.supervisionRate ? String(r.supervisionRate) : "",
    };
  }

  useEffect(() => {
    if (!open) return;
    const d = invoice ? deskOf(invoice.department) : RECEIPT_DESKS.find((x) => x.key === defaultDesk)!;
    setDeskKey(d.key);
    setOtherDept(invoice && d.key === "other" ? invoice.department : "");
    setPatientName(invoice?.patientName ?? "");
    setPatientPhone(invoice?.patientPhone ?? "");
    setPatient(invoice?.patientId ? { id: invoice.patientId, mrn: invoice.patientMrn ?? "" } : null);
    setSuggestions([]);
    setSaving(false);
    const ownRest = invoice?.credit?.accountId.startsWith("pt-");
    setPaid(ownRest ? String(invoiceAmounts(invoice!).paidNow) : "");
    setDate(invoice?.date ?? isoDate(new Date()));
    setPaymentMethod(invoice?.paymentMethod ?? lists.paymentMethods[0]?.id ?? "cash");
    setBankId(invoice?.boxId && db.cashboxes.find((b) => b.id === invoice.boxId && isBank(b)) ? invoice.boxId : "");
    setItems(
      invoice?.items.length
        ? invoice.items.map((i) => ({
            description: i.description,
            qty: String(i.qty),
            unitPrice: String(i.unitPrice),
            kind: i.kind,
            stockItemId: i.stockItemId,
          }))
        : [emptyItem()],
    );
    setDiscount(invoice?.discount ? String(invoice.discount) : "");
    setNotes(invoice?.notes ?? "");
    setDoctorId(invoice?.doctorId ?? NONE);
    setAnesthetistId(invoice?.anesthetistId ?? NONE);
    setClinicId(invoice?.clinicId ?? NONE);
    setReferredBy(invoice?.referredBy ?? "");
    setPayerId(invoice?.payer?.payerId ?? NONE);
    setPayerPct(invoice?.payer ? String(invoice.payer.percent) : "");
    setCreditId(invoice?.credit && !ownRest ? invoice.credit.accountId : NONE);
    setCreditAmt(invoice?.credit && !ownRest ? String(invoice.credit.amount) : "");
    setCreditCount(String(invoice?.credit?.installments?.length || 1));
    setCreditFirst(invoice?.credit?.installments?.[0]?.due ?? "");
    setStay(
      invoice?.stay
        ? {
            admitDate: invoice.stay.admitDate,
            dischargeDate: invoice.stay.dischargeDate,
            room: invoice.stay.room ?? "",
            roomRate: String(invoice.stay.roomRate),
            supervisionRate: String(invoice.stay.supervisionRate),
          }
        : stayDefaults(d.deptId ?? "icu"),
    );
    setCatalogQuery("");
    setCatalogGroup("all");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice, defaultDesk]);

  // Suggest existing patient files while the name / phone is typed (not after one is linked).
  useEffect(() => {
    if (!open || patient) return;
    const q = patientName.trim().length >= 2 ? patientName.trim() : patientPhone.trim();
    if (q.length < 2) return setSuggestions([]);
    let live = true;
    const t = setTimeout(() => {
      findPatientsForBilling({ data: { q } })
        .then((r) => live && setSuggestions(r))
        .catch(() => live && setSuggestions([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, patient, patientName, patientPhone]);

  // What the linked patient still owes from earlier receipts.
  useEffect(() => {
    setPrevRemaining(0);
    if (!open || !patient) return;
    let live = true;
    getPatientMoney({ data: { ids: [patient.id] } })
      .then((m) => {
        if (!live) return;
        const own = invoice?.credit?.accountId.startsWith("pt-") ? invoice.credit.amount : 0;
        setPrevRemaining(Math.max(0, (m[patient.id]?.remaining ?? 0) - own));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, patient, invoice]);

  function pickPatient(p: PatientRefLite) {
    setPatient({ id: p.id, mrn: p.mrn });
    setPatientName(p.fullName);
    if (p.phone) setPatientPhone(p.phone);
    setSuggestions([]);
  }

  function switchDesk(k: ReceiptDeskKey) {
    if (k === deskKey) return;
    const next = RECEIPT_DESKS.find((d) => d.key === k)!;
    setDeskKey(k);
    setCatalogQuery("");
    setCatalogGroup("all");
    if (next.stay) setStay(stayDefaults(next.deptId ?? otherDept));
    dropForeignLines(next.deptId ?? (next.key === "other" ? otherDept : ""));
  }

  /** Lines picked from the previous department's price list don't belong to the new one. */
  function dropForeignLines(nextDept: string) {
    const prevNames = new Set(
      lists.services.filter((s) => s.department && s.department === department).map((s) => s.name.trim()),
    );
    const nextNames = new Set(lists.services.filter((s) => s.department === nextDept).map((s) => s.name.trim()));
    const kept = items.filter((i) => {
      const n = i.description.trim();
      // Drugs sold from the pharmacy store don't belong to another department's receipt.
      if (i.stockItemId && nextDept !== "pharmacy") return false;
      return n && !(prevNames.has(n) && !nextNames.has(n));
    });
    const removed = items.filter((i) => i.description.trim()).length - kept.length;
    setItems(kept.length ? kept : [emptyItem()]);
    if (removed > 0) toast.info(`أُزيلت ${removed} خدمة من القسم السابق — اختر خدمات القسم الجديد.`);
  }

  const parsed = items.map((i) => ({
    description: i.description.trim(),
    qty: Number(i.qty) || 0,
    unitPrice: Number(i.unitPrice) || 0,
    kind: i.kind,
    stockItemId: i.stockItemId,
  }));
  const payer = payerId !== NONE ? lists.payers.find((p) => p.id === payerId) : undefined;
  const stayInput = desk.stay
    ? {
        admitDate: stay.admitDate,
        dischargeDate: stay.dischargeDate || stay.admitDate,
        roomRate: Number(stay.roomRate) || 0,
        supervisionRate: Number(stay.supervisionRate) || 0,
      }
    : undefined;
  const amountsInput = {
    items: parsed,
    discount: Number(discount) || 0,
    kind: desk.stay ? ("inpatient" as const) : ("outpatient" as const),
    stay: stayInput,
    payer: payer ? { payerId: payer.id, percent: Number(payerPct) || 0 } : undefined,
  };
  // Remaining on the patient = what they owe minus what they pay now — never typed by hand.
  const dueFromPatient = invoiceAmounts(amountsInput).patientShare;
  const paidTyped = creditId === NONE && paid.trim() !== "";
  const paidValue = Number(paid) || 0;
  const rest = paidTyped ? remainingAfterPayment(dueFromPatient, paidValue) : 0;
  const amounts = invoiceAmounts({
    ...amountsInput,
    credit: creditId !== NONE ? { amount: Number(creditAmt) || 0 } : rest > 0 ? { amount: rest } : undefined,
  });
  const creditAccounts = db.creditAccounts.filter((a) => !a.id.startsWith("pt-") && (a.active || a.id === creditId));
  const creditCountN = Math.max(1, Math.floor(Number(creditCount) || 1));
  const creditInput =
    creditId !== NONE && Number(creditAmt) > 0
      ? {
          accountId: creditId,
          amount: Number(creditAmt),
          installments:
            creditCountN > 1 ? makeInstallments(Number(creditAmt), creditCountN, creditFirst || addMonths(date || isoDate(new Date()), 1)) : undefined,
        }
      : undefined;

  /* ---------- Price catalog: only the chosen department's services (and the chosen specialty clinic) ---------- */
  const clinicDept = (desk.clinic || desk.surgery) && clinicId !== NONE ? clinicId : null;
  const today = isoDate(new Date());
  /** Pharmacy desk: the pharmacy's store items with their sale price and what is left in stock. */
  const pharmacyItems = useMemo<CatalogEntry[]>(() => {
    if (!desk.pharmacy) return [];
    return db.stockItems
      .filter((i) => i.department === "pharmacy" && i.active)
      .map((i) => {
        const mine = invoice?.items.filter((x) => x.stockItemId === i.id).reduce((s, x) => s + x.qty, 0) ?? 0;
        return {
          id: i.id,
          name: i.name,
          price: i.salePrice ?? 0,
          department: "pharmacy",
          group: lists.stockCategories.find((c) => c.id === i.category)?.name ?? "أصناف الصيدلية",
          stockItemId: i.id,
          unit: i.unit,
          balance: stockStatus(i, db.stockMoves, today).balance + mine,
        };
      });
  }, [desk.pharmacy, db.stockItems, db.stockMoves, lists.stockCategories, invoice, today]);
  const { own: deskServices, shared: sharedServices } = useMemo(
    () => servicesForDesk(lists.services, { department: department || null, clinicDept, stay: !!desk.stay }),
    [lists.services, department, clinicDept, desk.stay],
  );
  const sectionServices: CatalogEntry[] = desk.pharmacy ? [...pharmacyItems, ...deskServices] : deskServices;
  const catalogFor = (it: ItemDraft) =>
    findDeskService(it.description, sectionServices, sharedServices) as CatalogEntry | undefined;
  const allGroups = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const s of sectionServices) {
      const base = s.group ?? "خدمات القسم";
      const g = clinicDept && s.department === clinicDept ? `${findDepartment(departments, clinicDept).name} — ${base}` : base;
      groups.set(g, [...(groups.get(g) ?? []), s]);
    }
    return [...groups.entries()];
  }, [sectionServices, clinicDept, departments]);
  const catalog = useMemo(() => {
    const q = catalogQuery.trim();
    if (catalogGroup === SHARED && !q) return [[SHARED_LABEL, sharedServices as CatalogEntry[]] as const].filter(([, l]) => l.length > 0);
    return allGroups
      .filter(([g]) => q || catalogGroup === "all" || g === catalogGroup)
      .map(([g, svcs]) => [g, svcs.filter((s) => matches(q, s.name, g))] as const)
      .filter(([, svcs]) => svcs.length > 0);
  }, [allGroups, sharedServices, catalogGroup, catalogQuery]);

  function addService(svc: CatalogEntry) {
    if (svc.stockItemId && (svc.balance ?? 0) <= qtyOf(svc.name)) {
      toast.error(`لا يوجد رصيد كافٍ من «${svc.name}» في المخزن.`);
      return;
    }
    const at = items.findIndex((i) => i.description.trim() === svc.name);
    if (at >= 0) {
      setItems(items.map((it, i) => (i === at ? { ...it, qty: String((Number(it.qty) || 0) + 1) } : it)));
      return;
    }
    const row: ItemDraft = { description: svc.name, qty: "1", unitPrice: svc.price ? String(svc.price) : "", kind: svc.kind, stockItemId: svc.stockItemId };
    const emptyIdx = items.findIndex((i) => !i.description.trim() && !i.unitPrice);
    setItems(emptyIdx >= 0 ? items.map((it, i) => (i === emptyIdx ? row : it)) : [...items, row]);
  }
  const qtyOf = (name: string) =>
    items.filter((i) => i.description.trim() === name).reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const setItem = (idx: number, k: keyof ItemDraft, v: string) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));

  const clinics = departments.filter(
    (d) =>
      CLINICAL_GROUPS.includes(d.group) &&
      d.active &&
      !["clinics", "inpatient", "surgery", "anesthesia", "dialysis", "endoscopy", "physio"].includes(d.id),
  );
  /** Operating theatre: the surgical specialty whose operations are added to the list. */
  const specialties = departments.filter((d) => d.group === "surgical" && d.active && !["surgery", "anesthesia"].includes(d.id));
  const activeDoctors = doctors
    .filter((d) => d.active || d.id === doctorId)
    .sort(
      (a, b) =>
        Number(b.department === department || b.department === clinicId) -
        Number(a.department === department || a.department === clinicId),
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const valid = parsed.filter((i) => i.description && i.qty > 0 && i.unitPrice > 0);
    if (!patientName.trim()) return setError("اكتب اسم المريض.");
    if (!department) return setError("اختر القسم أولًا.");
    if (desk.clinic && clinicId === NONE) return setError("اختر العيادة التخصصية.");
    if (desk.stay) {
      if (!stay.admitDate) return setError("اكتب تاريخ الدخول.");
      if (stay.dischargeDate && stay.dischargeDate < stay.admitDate)
        return setError("تاريخ الخروج قبل تاريخ الدخول.");
      if (!(Number(stay.roomRate) > 0)) return setError("اكتب سعر يوم الإقامة.");
    } else if (!valid.length) return setError("أضف خدمة واحدة على الأقل بكمية وسعر.");
    if (valid.length !== parsed.filter((i) => i.description || i.unitPrice).length)
      return setError("أكمل بيانات كل الخدمات (البيان والكمية والسعر) أو احذف الصف الناقص.");
    if (payer && !(Number(payerPct) >= 0 && Number(payerPct) <= 100))
      return setError("نسبة التغطية يجب أن تكون بين ٠ و١٠٠.");
    if (creditId !== NONE && !(Number(creditAmt) > 0)) return setError("اكتب المبلغ الآجل أو اختر «بدون آجل».");
    if (paidTyped && paidValue < 0) return setError("المبلغ المدفوع لا يكون بالسالب.");
    if (paidTyped && paidValue > dueFromPatient + 0.001)
      return setError(`المدفوع أكبر من المطلوب من المريض (${egp(dueFromPatient)}).`);
    // Every receipt belongs to a patient file: open one automatically for a new patient.
    let linked = patient;
    if (!linked) {
      setSaving(true);
      try {
        const p = await openPatientFromBilling({ data: { fullName: patientName.trim(), phone: patientPhone.trim() || null } });
        linked = { id: p.id, mrn: p.mrn };
        setPatient(linked);
      } catch {
        if (rest > 0) {
          setSaving(false);
          return setError("تعذّر فتح ملف للمريض، فلا يمكن تسجيل مبلغ متبقٍ عليه. حاول مرة أخرى.");
        }
        toast.warning("حُفظ الإيصال بدون ربطه بملف مريض (تعذّر فتح الملف).");
      } finally {
        setSaving(false);
      }
    }
    const inv = savePatientInvoice(
      {
        date,
        patientName: patientName.trim(),
        patientPhone: patientPhone.trim() || undefined,
        patientId: linked?.id,
        patientMrn: linked?.mrn,
        remaining: creditId === NONE ? rest : undefined,
        department,
        items: valid,
        discount: Number(discount) || 0,
        paymentMethod,
        ...(bankId ? { boxId: bankId } : {}),
        notes: notes.trim() || undefined,
        kind: desk.stay ? "inpatient" : "outpatient",
        stay: stayInput ? { ...stayInput, room: stay.room.trim() || undefined } : undefined,
        doctorId: doctorId !== NONE ? doctorId : undefined,
        anesthetistId: desk.surgery && anesthetistId !== NONE ? anesthetistId : undefined,
        clinicId: (desk.clinic || desk.surgery) && clinicId !== NONE ? clinicId : undefined,
        referredBy: desk.referral ? referredBy.trim() || undefined : undefined,
        payer: payer ? { payerId: payer.id, percent: Number(payerPct) || 0 } : undefined,
        credit: creditInput,
      },
      invoice,
    );
    if (!inv) return;
    onOpenChange(false);
    onSaved(inv, !!invoice);
  }

  const deptName = department ? findDepartment(departments, department).name : "لم يُحدَّد القسم";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[94vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {invoice ? "تعديل إيصال" : "إيصال جديد"}
          </DialogTitle>
          <DialogDescription>
            {invoice ? (
              <>
                رقم الإيصال <span dir="ltr">{invoice.number}</span> — يُحدَّث قيده في الخزينة تلقائيًا.
              </>
            ) : (
              "اختر القسم ثم أضف الخدمات من قائمة أسعاره — يُسجَّل الإيصال كإيراد للقسم في الخزينة."
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Section picker */}
        <div role="tablist" aria-label="قسم الإيصال" className="grid grid-cols-4 gap-2 lg:grid-cols-8">
          {RECEIPT_DESKS.map((d) => {
            const Icon = DESK_ICONS[d.key];
            const active = d.key === deskKey;
            return (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchDesk(d.key)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "bg-card hover:bg-muted",
                )}
              >
                <Icon className="size-5" />
                <span className="text-sm font-semibold">{d.label}</span>
                <span className={cn("hidden text-[10px] leading-tight lg:block", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {d.hint}
                </span>
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid content-start gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="اسم المريض" htmlFor="pi-name" className="relative">
                <Input
                  id="pi-name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  readOnly={!!patient}
                  autoComplete="off"
                  autoFocus
                />
                {patient ? (
                  <span className="patient-link">
                    <FolderOpen className="size-3.5" /> ملف <span dir="ltr" className="num">{patient.mrn}</span>
                    {prevRemaining > 0 && <span className="text-expense">— متبقٍ عليه سابقًا {egp(prevRemaining)}</span>}
                    <button type="button" onClick={() => setPatient(null)} aria-label="فك الربط بملف المريض" className="mr-auto rounded p-0.5 hover:bg-muted">
                      <X className="size-3.5" />
                    </button>
                  </span>
                ) : (
                  suggestions.length > 0 && (
                    <div role="listbox" aria-label="ملفات مرضى مطابقة" className="patient-suggest">
                      {suggestions.map((p) => (
                        <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => pickPatient(p)} className="patient-suggest-item">
                          <span className="font-semibold">{p.fullName}</span>
                          <span className="num text-xs text-muted-foreground" dir="ltr">{p.mrn}{p.phone ? ` · ${p.phone}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  )
                )}
              </FieldRow>
              <FieldRow label="رقم التليفون (اختياري)" htmlFor="pi-phone">
                <Input id="pi-phone" value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} inputMode="tel" />
              </FieldRow>
              {desk.key === "other" && (
                <FieldRow label="القسم (مركز التكلفة)">
                  <DeptSelect
                    value={otherDept}
                    placeholder="اختر القسم أولًا"
                    onChange={(v) => {
                      if (v === otherDept) return;
                      dropForeignLines(v);
                      setCatalogQuery("");
                      setCatalogGroup("all");
                      setOtherDept(v);
                    }}
                  />
                </FieldRow>
              )}
              {desk.clinic && (
                <FieldRow label="العيادة التخصصية">
                  <Select value={clinicId} onValueChange={setClinicId}>
                    <SelectTrigger aria-label="العيادة التخصصية">
                      <SelectValue placeholder="اختر العيادة" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value={NONE} disabled>
                        اختر العيادة
                      </SelectItem>
                      {clinics.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          عيادة {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              )}
              {desk.surgery && (
                <FieldRow label="التخصص الجراحي (اختياري)">
                  <Select value={clinicId} onValueChange={setClinicId}>
                    <SelectTrigger aria-label="التخصص الجراحي">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value={NONE}>بدون — خدمات غرفة العمليات والباقات فقط</SelectItem>
                      {specialties.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              )}
              {desk.referral && (
                <FieldRow label="الطبيب / الجهة المحوِّلة (اختياري)" htmlFor="pi-ref">
                  <Input id="pi-ref" value={referredBy} onChange={(e) => setReferredBy(e.target.value)} placeholder="مثال: د. أحمد — عيادة الباطنة" />
                </FieldRow>
              )}
              {activeDoctors.length > 0 && (
                <FieldRow label={desk.stay ? "الطبيب المشرف" : desk.surgery ? "الجراح" : "الطبيب المعالج"}>
                  <Select value={doctorId} onValueChange={setDoctorId}>
                    <SelectTrigger aria-label="الطبيب">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value={NONE}>بدون طبيب محدد</SelectItem>
                      {activeDoctors.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          د. {d.name} — {d.specialty}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              )}
              {desk.surgery && activeDoctors.length > 0 && (
                <FieldRow label="طبيب التخدير">
                  <Select value={anesthetistId} onValueChange={setAnesthetistId}>
                    <SelectTrigger aria-label="طبيب التخدير">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value={NONE}>بدون طبيب تخدير محدد</SelectItem>
                      {[...activeDoctors]
                        .sort((a, b) => Number(b.department === "anesthesia") - Number(a.department === "anesthesia"))
                        .map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            د. {d.name} — {d.specialty}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              )}
              <FieldRow label="التاريخ" htmlFor="pi-date">
                <Input id="pi-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </FieldRow>
              <FieldRow label="طريقة الدفع">
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger aria-label="طريقة الدفع">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {lists.paymentMethods.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="الخزينة اللي استلمت الفلوس">
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">
                  {findBox(db, boxForDepartment(department)).name}
                  <span className="ms-auto text-[11px] font-normal text-muted-foreground">
                    تلقائي حسب القسم
                  </span>
                </div>
              </FieldRow>
              {picksBank && department !== "icu" && db.cashboxes.some((b) => isBank(b) && b.active) && (
                <FieldRow label="حساب بنكي بدل النقدية (اختياري)">
                  <Select value={bankId || "__none"} onValueChange={(v) => setBankId(v === "__none" ? "" : v)}>
                    <SelectTrigger aria-label="حساب بنكي">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="__none">بدون — الخزينة النقدية</SelectItem>
                      {db.cashboxes
                        .filter((b) => isBank(b) && b.active)
                        .map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              )}
            </div>

            {desk.stay && (
              <fieldset className="grid gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-3">
                <legend className="px-1 text-sm font-semibold">الإقامة بالعناية</legend>
                <FieldRow label="تاريخ الدخول" htmlFor="st-in">
                  <Input id="st-in" type="date" value={stay.admitDate} onChange={(e) => setStay({ ...stay, admitDate: e.target.value })} />
                </FieldRow>
                <FieldRow label="تاريخ الخروج" htmlFor="st-out">
                  <Input id="st-out" type="date" value={stay.dischargeDate} onChange={(e) => setStay({ ...stay, dischargeDate: e.target.value })} />
                </FieldRow>
                <FieldRow label="رقم السرير" htmlFor="st-bed">
                  <Input id="st-bed" value={stay.room} onChange={(e) => setStay({ ...stay, room: e.target.value })} />
                </FieldRow>
                <FieldRow label="سعر يوم الإقامة" htmlFor="st-rr">
                  <Input id="st-rr" type="number" min="0" step="0.01" value={stay.roomRate} onChange={(e) => setStay({ ...stay, roomRate: e.target.value })} />
                </FieldRow>
                <FieldRow label="الإشراف الطبي / يوم" htmlFor="st-sr">
                  <Input id="st-sr" type="number" min="0" step="0.01" value={stay.supervisionRate} onChange={(e) => setStay({ ...stay, supervisionRate: e.target.value })} />
                </FieldRow>
                <div className="flex items-end">
                  <p className="w-full rounded-md bg-card px-3 py-2 text-sm">
                    <span className="text-muted-foreground">المدة: </span>
                    <b className="num">{int(amounts.days)}</b> يوم
                  </p>
                </div>
              </fieldset>
            )}

            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">
                خدمات الإيصال <span className="font-normal text-muted-foreground">— {deptName}</span>
              </p>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-[4rem_1fr_auto] items-center gap-2 border-b pb-2 last:border-0 sm:grid-cols-[1fr_4.5rem_6.5rem_auto] sm:border-0 sm:pb-0">
                    <Input
                      aria-label="بيان الخدمة"
                      placeholder="بيان الخدمة"
                      list="service-names"
                      className="col-span-3 sm:col-span-1"
                      value={it.description}
                      onChange={(e) => {
                        const v = e.target.value;
                        const svc = findDeskService(v, sectionServices, sharedServices) as CatalogEntry | undefined;
                        setItems(
                          items.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  description: v,
                                  kind: svc?.kind ?? row.kind,
                                  stockItemId: svc?.stockItemId,
                                  unitPrice: svc ? String(svc.price) : row.unitPrice,
                                }
                              : row,
                          ),
                        );
                      }}
                    />
                    <Input aria-label="الكمية" type="number" min="1" value={it.qty} onChange={(e) => setItem(idx, "qty", e.target.value)} />
                    {(() => {
                      const svc = catalogFor(it);
                      const locked = svc ? !svc.variablePrice : !canManual;
                      return (
                        <Input
                          aria-label="السعر"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="السعر"
                          value={it.unitPrice}
                          readOnly={locked}
                          disabled={locked}
                          title={
                            locked
                              ? svc
                                ? "السعر ثابت من خدمات الأقسام — عدّله من خدمات الأقسام أولًا"
                                : "خدمة غير مسجلة — أضفها من خدمات الأقسام أولًا"
                              : svc?.variablePrice
                                ? "سعر متغيّر: يمكن تعديله في هذا الإيصال"
                                : "سطر يدوي — أضف الخدمة من خدمات الأقسام لتثبيت سعرها"
                          }
                          className={cn(locked && "bg-muted/60 text-muted-foreground")}
                          onChange={(e) => setItem(idx, "unitPrice", e.target.value)}
                        />
                      );
                    })()}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="حذف الخدمة"
                      disabled={items.length === 1 && !it.description}
                      onClick={() => setItems(items.length === 1 ? [emptyItem()] : items.filter((_, i) => i !== idx))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <datalist id="service-names">
                {[...sectionServices, ...sharedServices].map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              {canManual && (
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setItems([...items, emptyItem()])}>
                  <Plus /> سطر يدوي
                </Button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {lists.payers.length > 0 && (
                <>
                  <FieldRow label="جهة التعاقد / التأمين">
                    <Select
                      value={payerId}
                      onValueChange={(v) => {
                        setPayerId(v);
                        const p = lists.payers.find((x) => x.id === v);
                        setPayerPct(p ? String(p.percent) : "");
                      }}
                    >
                      <SelectTrigger aria-label="جهة التعاقد">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value={NONE}>بدون — المريض يدفع كامل المبلغ</SelectItem>
                        {lists.payers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({int(p.percent)}٪)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label="نسبة تغطية الجهة (٪)" htmlFor="pi-pct">
                    <Input id="pi-pct" type="number" min="0" max="100" disabled={!payer} value={payerPct} onChange={(e) => setPayerPct(e.target.value)} />
                  </FieldRow>
                </>
              )}
              {creditAccounts.length > 0 && (
                <>
                  <FieldRow label="جزء آجل على حساب (تقسيط / شركة متعاقدة)">
                    <Select value={creditId} onValueChange={(v) => { setCreditId(v); if (v !== NONE && !creditAmt) setCreditAmt(String(amounts.patientShare)); }}>
                      <SelectTrigger aria-label="الحساب الآجل"><SelectValue /></SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value={NONE}>بدون آجل — يُدفع كله الآن</SelectItem>
                        {creditAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}{a.kind === "company" ? " (شركة)" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  {creditId !== NONE && (
                    <div className="grid grid-cols-3 gap-2">
                      <FieldRow label="المبلغ الآجل" htmlFor="pi-cr"><Input id="pi-cr" type="number" min="0" value={creditAmt} onChange={(e) => setCreditAmt(e.target.value)} /></FieldRow>
                      <FieldRow label="عدد الأقساط" htmlFor="pi-crn"><Input id="pi-crn" type="number" min="1" max="60" value={creditCount} onChange={(e) => setCreditCount(e.target.value)} /></FieldRow>
                      <FieldRow label="أول قسط" htmlFor="pi-crf"><Input id="pi-crf" type="date" disabled={creditCountN <= 1} value={creditFirst || addMonths(date || isoDate(new Date()), 1)} onChange={(e) => setCreditFirst(e.target.value)} /></FieldRow>
                    </div>
                  )}
                </>
              )}
              <FieldRow label="خصم (ج.م)" htmlFor="pi-disc">
                <Input id="pi-disc" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </FieldRow>
              <FieldRow label="ملاحظات (اختياري)" htmlFor="pi-notes">
                <Textarea id="pi-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </FieldRow>
              {creditId === NONE && (
                <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:col-span-2 sm:grid-cols-3">
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">المطلوب من المريض</p>
                    <p className="num text-lg font-bold">{egp(dueFromPatient)}</p>
                  </div>
                  <FieldRow label="المدفوع الآن" htmlFor="pi-paid">
                    <div className="flex gap-1">
                      <Input
                        id="pi-paid"
                        type="number"
                        min="0"
                        step="0.01"
                        value={paid}
                        onChange={(e) => setPaid(e.target.value)}
                        placeholder={`كامل المبلغ ${money(dueFromPatient)}`}
                        className="bg-card"
                      />
                      {paidTyped && (
                        <Button type="button" size="sm" variant="ghost" className="h-9 shrink-0 px-2 text-xs" onClick={() => setPaid("")}>
                          دفع كامل
                        </Button>
                      )}
                    </div>
                  </FieldRow>
                  <div className="text-sm" aria-live="polite">
                    <p className="text-xs text-muted-foreground">المتبقي على المريض (تلقائي)</p>
                    <p className={cn("num text-lg font-bold", rest > 0 ? "text-expense" : "text-income")}>{rest > 0 ? egp(rest) : "لا يوجد"}</p>
                    {rest > 0 && <p className="text-[11px] text-muted-foreground">يظهر في صفحة المرضى ويُحصَّل لاحقًا</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-y-1 rounded-lg border border-dashed bg-muted/60 p-3 text-sm">
              <span className="text-muted-foreground">الخدمات</span>
              <span className="num text-left">{egp(amounts.items)}</span>
              {desk.stay && (
                <>
                  <span className="text-muted-foreground">الإقامة ({int(amounts.days)} يوم)</span>
                  <span className="num text-left">{egp(amounts.room)}</span>
                  <span className="text-muted-foreground">الإشراف الطبي</span>
                  <span className="num text-left">{egp(amounts.supervision)}</span>
                </>
              )}
              <span className="text-muted-foreground">الخصم</span>
              <span className="num text-left text-expense">{egp(amounts.discount)}</span>
              <span className="font-semibold">صافي الإيصال</span>
              <span className="num text-left font-bold">{egp(amounts.total)}</span>
              {payer && (
                <>
                  <span className="text-muted-foreground">على {payer.name}</span>
                  <span className="num text-left">{egp(amounts.insurerShare)}</span>
                </>
              )}
              {amounts.credit > 0 && creditId !== NONE && (
                <>
                  <span className="text-muted-foreground">آجل على الحساب{creditCountN > 1 ? ` (${int(creditCountN)} أقساط)` : ""}</span>
                  <span className="num text-left">{egp(amounts.credit)}</span>
                </>
              )}
              {amounts.credit > 0 && creditId === NONE && (
                <>
                  <span className="font-semibold text-expense">المتبقي على المريض</span>
                  <span className="num text-left font-bold text-expense">{egp(amounts.credit)}</span>
                </>
              )}
              <span className="font-semibold">يُحصَّل من المريض الآن</span>
              <span className="num text-left text-lg font-bold text-income">{egp(amounts.paidNow)}</span>
            </div>

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:justify-start">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {invoice ? "حفظ التعديلات" : "حفظ الإيصال وتسجيله بالخزينة"}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                إلغاء
              </Button>
            </DialogFooter>
          </div>

          {/* Price list of the section */}
          <aside className="flex max-h-[70vh] flex-col overflow-hidden rounded-lg border bg-muted/30 lg:sticky lg:top-0" aria-label="قائمة أسعار القسم">
            <div className="border-b bg-card p-3">
              <p className="mb-2 text-sm font-semibold">قائمة أسعار {desk.key === "other" ? deptName : desk.label}</p>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="ابحث عن خدمة..." className="h-8 pr-8 text-sm" aria-label="بحث في قائمة الأسعار" />
              </div>
              {(allGroups.length > 1 || sharedServices.length > 0) && !catalogQuery.trim() && (
                <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="مجموعات الخدمات">
                  {[
                    ["all", sectionServices.length] as const,
                    ...(allGroups.length > 1 ? allGroups.map(([g, svcs]) => [g, svcs.length] as const) : []),
                    ...(sharedServices.length ? [[SHARED, sharedServices.length] as const] : []),
                  ].map(([g, n]) => (
                    <button
                      key={g}
                      type="button"
                      role="tab"
                      aria-selected={catalogGroup === g}
                      onClick={() => setCatalogGroup(g)}
                      className={cn("chip-filter", catalogGroup === g && "chip-filter-active")}
                    >
                      {g === "all" ? "كل خدمات القسم" : g === SHARED ? SHARED_LABEL : g}
                      <span className="num opacity-70">{int(n)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {catalog.map(([g, svcs]) => (
                <section key={g}>
                  <h4 className="mb-1.5 flex items-center justify-between text-xs font-bold text-muted-foreground">
                    <span>{g}</span>
                    <span className="num font-normal">{int(svcs.length)}</span>
                  </h4>
                  <div className="grid gap-1.5">
                    {svcs.map((s) => {
                      const q = qtyOf(s.name);
                      return (
                        <div key={s.id} className={cn("flex items-center gap-1 rounded-md border bg-card text-sm transition-colors", q > 0 && "border-primary bg-primary/5")}>
                          <button type="button" onClick={() => addService(s)} aria-label={`إضافة ${s.name} — ${money(s.price)} ج.م`} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-1.5 text-right">
                            <span className="truncate">{s.name}</span>
                            <span className="num shrink-0 text-xs text-muted-foreground">
                              {s.stockItemId && (
                                <span className={cn("ml-1.5", (s.balance ?? 0) > 0 ? "" : "text-destructive")}>
                                  متاح {int(s.balance ?? 0)} {s.unit}
                                </span>
                              )}
                              {s.price ? money(s.price) : "بدون سعر بيع"}
                            </span>
                          </button>
                          {q > 0 && (
                            <span className="flex shrink-0 items-center gap-0.5 pl-1">
                              <span className="num min-w-5 rounded bg-primary px-1 text-center text-xs font-bold text-primary-foreground">{int(q)}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={`إنقاص ${s.name}`}
                                onClick={() => {
                                  const at = items.findIndex((i) => i.description.trim() === s.name);
                                  const n = (Number(items[at]!.qty) || 0) - 1;
                                  setItems(
                                    n > 0
                                      ? items.map((it, i) => (i === at ? { ...it, qty: String(n) } : it))
                                      : items.length > 1
                                        ? items.filter((_, i) => i !== at)
                                        : [emptyItem()],
                                  );
                                }}
                              >
                                <Minus className="size-3.5" />
                              </Button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!catalog.length && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {!department
                    ? "اختر القسم أولًا لتظهر خدماته وأسعاره."
                    : catalogQuery
                      ? "لا توجد خدمة بهذا الاسم في هذا القسم."
                      : desk.pharmacy
                      ? "لا توجد أصناف للصيدلية في المخزن بعد. أضفها من صفحة المخزن العام مع سعر البيع."
                      : "لا توجد خدمات مسعّرة لهذا القسم بعد. أضفها من صفحة خدمات الأقسام وأسعارها."}
                </p>
              )}
            </div>
          </aside>
        </form>
      </DialogContent>
    </Dialog>
  );
}
