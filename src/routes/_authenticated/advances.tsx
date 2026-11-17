import { createFileRoute, Link } from "@tanstack/react-router";
import { Banknote, Check, Clock, HandCoins, Plus, Trash2, Users, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, FieldRow, HeadRow, matches, SearchBox, TableCard, Td, Th } from "@/components/hospital/kit";
import { StatusBadge } from "@/components/hospital/orders/StatusBadge";
import { PayMoneyDialog } from "@/components/hospital/refunds/PayMoneyDialog";
import { deductedOf, dueFor, installmentOf, remainingOf } from "@/lib/hospital/advances";
import { dateLabel, egp, int, isoDate, money, monthLabel, periodOf } from "@/lib/hospital/format";
import {
  canSpendDirectly,
  decideAdvance,
  deleteAdvance,
  ORDER_STATUS_LABELS,
  payAdvance,
  requestAdvance,
  useCan,
  useCanApprove,
  useHospitalDB,
  useHospitalSession,
  type Advance,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/advances")({
  head: () => ({
    meta: [
      { title: "سلف الموظفين | مستشفى الرحمة التخصصي" },
      { name: "description", content: "سلف العاملين: طلب واعتماد المدير المالي وصرف، ثم خصم القسط من المرتب كل شهر تلقائيًا عند ترحيل الرواتب." },
      { property: "og:title", content: "سلف الموظفين | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "متابعة سلف الموظفين وأقساطها الشهرية والمتبقي على كل موظف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdvancesPage,
});

const STATUS_LABEL: Record<Advance["status"], string> = { ...ORDER_STATUS_LABELS, paid: "مصروفة — تُخصم من المرتب" };

function AdvancesPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canAdd = useCan("payroll", "add");
  const canApprove = useCanApprove();
  const manager = !!me && canSpendDirectly(me);
  const [show, setShow] = useState<"open" | "all" | Advance["status"]>("open");
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState<Advance | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const period = periodOf(new Date());

  const rows = useMemo(
    () =>
      db.advances
        .filter((a) =>
          show === "all" ? true : show === "open" ? a.status !== "rejected" && !(a.status === "paid" && remainingOf(a) === 0) : a.status === show,
        )
        .filter((a) => matches(query, a.employeeName, a.number, a.reason))
        .sort((a, b) => b.createdAt - a.createdAt),
    [db.advances, show, query],
  );
  const outstanding = db.advances.filter((a) => a.status === "paid").reduce((s, a) => s + remainingOf(a), 0);
  const dueNow = db.advances.reduce((s, a) => s + dueFor(a, period), 0);
  const pending = db.advances.filter((a) => a.status === "pending");
  const approved = db.advances.filter((a) => a.status === "approved");

  function decide(a: Advance, approve: boolean) {
    const note = approve ? undefined : (window.prompt("سبب الرفض (اختياري):") ?? undefined);
    if (decideAdvance(a.id, approve, note)) toast.success(approve ? "تم اعتماد السلفة — يصرفها المدير المالي." : "تم رفض طلب السلفة.");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المصروفات وشؤون العاملين"
        title="سلف الموظفين"
        description="الموظف ياخد سلفة بعد اعتماد المدير المالي، وتتخصم من مرتبه على أقساط شهرية تلقائيًا لما رواتب الشهر تترحّل للخزينة."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/payroll">
                <Users /> الأجور والمرتبات
              </Link>
            </Button>
            {canAdd && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> طلب سلفة
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="بانتظار الاعتماد" value={int(pending.length)} icon={Clock} tone="copper" hint={`${money(pending.reduce((s, a) => s + a.amount, 0))} ج.م`} />
        <StatCard label="معتمدة — لم تُصرف" value={int(approved.length)} icon={Check} tone="primary" hint={`${money(approved.reduce((s, a) => s + a.amount, 0))} ج.م`} />
        <StatCard label="المتبقي على الموظفين" value={money(outstanding)} icon={HandCoins} tone="expense" hint="من السلف المصروفة" />
        <StatCard label={`أقساط ${monthLabel(period)}`} value={money(dueNow)} icon={Wallet} hint="تُخصم عند ترحيل رواتب الشهر" />
      </div>

      <div className="ledger-card mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="حالة السلفة">
          {(["open", "pending", "approved", "paid", "rejected", "all"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)} className={cn("chip-filter", show === k && "chip-filter-active")}>
              {k === "open" ? "الجارية" : k === "all" ? "الكل" : k === "paid" ? "المصروفة" : STATUS_LABEL[k]}
            </button>
          ))}
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder="اسم الموظف أو رقم السلفة" className="sm:w-72" />
      </div>

      <TableCard minWidth={980}>
        <thead>
          <HeadRow>
            <Th>رقم السلفة</Th>
            <Th>الموظف</Th>
            <Th num>المبلغ</Th>
            <Th>الأقساط</Th>
            <Th num>المخصوم</Th>
            <Th num>المتبقي</Th>
            <Th>الحالة</Th>
            <Th className="text-left">إجراءات</Th>
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((a) => {
            const mine = a.requestedById === me?.id;
            return (
              <tr key={a.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td className="font-mono text-xs">
                  <span dir="ltr">{a.number}</span>
                  <p className="font-sans text-[11px] text-muted-foreground">{dateLabel(a.date)}</p>
                </Td>
                <Td>
                  <p className="font-semibold">{a.employeeName}</p>
                  <DeptBadge id={a.department} className="mt-1" />
                  <p className="mt-1 text-[11px] text-muted-foreground">السبب: {a.reason}</p>
                </Td>
                <Td num className="font-bold">{money(a.amount)}</Td>
                <Td>
                  <p className="text-sm">
                    <span className="num">{int(a.months)}</span> × <span className="num">{money(installmentOf(a))}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">من مرتب {monthLabel(a.startPeriod)}</p>
                </Td>
                <Td num className="text-income">{money(deductedOf(a))}</Td>
                <Td num className="font-bold text-expense">{a.status === "paid" ? money(remainingOf(a)) : "—"}</Td>
                <Td>
                  <StatusBadge status={a.status} label={a.status === "paid" && remainingOf(a) === 0 ? "سُدِّدت بالكامل" : STATUS_LABEL[a.status]} />
                  {a.decisionNote && <p className="mt-1 text-[11px] text-muted-foreground">{a.decisionNote}</p>}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {a.status === "pending" && canApprove(a) && (
                      <>
                        <Button size="sm" className="px-2" onClick={() => decide(a, true)}>
                          <Check /> اعتماد
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2 text-destructive" onClick={() => decide(a, false)}>
                          <X /> رفض
                        </Button>
                      </>
                    )}
                    {a.status === "approved" && manager && (
                      <Button size="sm" className="px-2" onClick={() => setPaying(a)}>
                        <Banknote /> صرف السلفة
                      </Button>
                    )}
                    {(a.status === "paid" ? manager && !a.deductions.length : mine || manager) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف السلفة ${a.number}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (window.confirm(a.status === "paid" ? "حذف السلفة المصروفة؟ سيُلغى قيدها من الخزينة." : "حذف طلب السلفة؟"))
                            if (deleteAdvance(a.id)) toast.success("تم الحذف.");
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={8} text="لا توجد سلف في هذا العرض." />}
        </tbody>
      </TableCard>

      <NewAdvanceDialog open={newOpen} onOpenChange={setNewOpen} />
      <PayMoneyDialog
        open={!!paying}
        onOpenChange={(o) => !o && setPaying(null)}
        forceManagerBox
        title="صرف السلفة للموظف"
        description={paying ? `${paying.employeeName} — تُخصم على ${paying.months} شهر من ${monthLabel(paying.startPeriod)}` : ""}
        amount={paying?.amount ?? 0}
        onPay={(p) => {
          if (!paying) return false;
          const ok = payAdvance({ id: paying.id, date: p.date, boxId: p.boxId, method: p.method });
          if (ok) toast.success("تم صرف السلفة وتسجيلها على الموظف.");
          return ok;
        }}
      />
    </div>
  );
}

function NewAdvanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useHospitalDB();
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState("3");
  const [date, setDate] = useState(isoDate(new Date()));
  const [start, setStart] = useState(periodOf(new Date()));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const staff = db.employees.filter((e) => !e.personal?.leftOn).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const n = Math.max(1, Math.floor(Number(months) || 1));
  const open_ = db.advances.filter((a) => a.employeeId === employeeId && a.status === "paid").reduce((s, a) => s + remainingOf(a), 0);

  function reset() {
    setEmployeeId("");
    setAmount("");
    setMonths("3");
    setDate(isoDate(new Date()));
    setStart(periodOf(new Date()));
    setReason("");
    setError("");
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return setError("اختر الموظف.");
    if (!(Number(amount) > 0)) return setError("اكتب مبلغ السلفة.");
    if (requestAdvance({ date, employeeId, amount: Number(amount), months: n, startPeriod: start, reason })) {
      toast.success("أُرسل طلب السلفة للمدير المالي للاعتماد.");
      reset();
      onOpenChange(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">طلب سلفة لموظف</DialogTitle>
          <DialogDescription>تُصرف بعد اعتماد المدير المالي، وتتخصم من المرتب على أقساط شهرية متساوية.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="الموظف" className="sm:col-span-2">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger aria-label="الموظف">
                <SelectValue placeholder={staff.length ? "اختر الموظف" : "أضف الموظفين أولًا من صفحة الأجور"} />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {staff.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} — {e.jobTitle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {open_ > 0 && <p className="text-xs text-expense">عليه سلف سابقة متبقٍ منها {egp(open_)}</p>}
          </FieldRow>
          <FieldRow label="مبلغ السلفة (ج.م)" htmlFor="adv-amt">
            <Input id="adv-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FieldRow>
          <FieldRow label="عدد الأقساط (شهور)" htmlFor="adv-n">
            <Input id="adv-n" type="number" min="1" max="36" value={months} onChange={(e) => setMonths(e.target.value)} />
          </FieldRow>
          <FieldRow label="تاريخ الطلب" htmlFor="adv-date">
            <Input id="adv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FieldRow>
          <FieldRow label="أول قسط من مرتب شهر" htmlFor="adv-start">
            <Input id="adv-start" type="month" value={start} onChange={(e) => setStart(e.target.value)} />
          </FieldRow>
          <FieldRow label="السبب" htmlFor="adv-reason" className="sm:col-span-2">
            <Textarea id="adv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldRow>
          {Number(amount) > 0 && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm sm:col-span-2">
              القسط الشهري: <b className="num">{egp(Math.round((Number(amount) / n) * 100) / 100)}</b> لمدة <b className="num">{int(n)}</b> شهر
            </p>
          )}
          {error && <p className="text-sm font-medium text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="gap-2 sm:col-span-2 sm:justify-start">
            <Button type="submit">إرسال للاعتماد</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
