import { createFileRoute, Link } from "@tanstack/react-router";
import { Banknote, Check, Clock, Receipt, Trash2, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, HeadRow, matches, MonthYearPicker, SearchBox, TableCard, Td, Th } from "@/components/hospital/kit";
import { StatusBadge } from "@/components/hospital/orders/StatusBadge";
import { PayMoneyDialog } from "@/components/hospital/refunds/PayMoneyDialog";
import { dateLabel, int, money, periodOf } from "@/lib/hospital/format";
import {
  canSpendDirectly,
  decideRefund,
  deleteRefund,
  findBox,
  ORDER_STATUS_LABELS,
  payRefund,
  useCan,
  useCanApprove,
  useHospitalDB,
  useHospitalSession,
  type Refund,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/refunds")({
  head: () => ({
    meta: [
      { title: "مرتجعات المرضى | مستشفى الرحمة التخصصي" },
      { name: "description", content: "رد فلوس المريض عن خدمة أُلغيت بعد الدفع: طلب، اعتماد المدير المالي، ثم صرف من الخزينة الرئيسية وعكس الإيراد تلقائيًا." },
      { property: "og:title", content: "مرتجعات المرضى | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "طلبات رد المبالغ للمرضى واعتمادها وصرفها مع عكس الإيراد وإرجاع الأدوية للمخزن." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RefundsPage,
});

const STATUS_LABEL: Record<Refund["status"], string> = { ...ORDER_STATUS_LABELS, paid: "تم الرد للمريض" };

function RefundsPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canAdd = useCan("billing", "add");
  const canApprove = useCanApprove();
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [show, setShow] = useState<"all" | Refund["status"]>("all");
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState<Refund | null>(null);

  const inPeriod = useMemo(() => db.refunds.filter((r) => period === "all" || r.date.startsWith(period)), [db.refunds, period]);
  const rows = inPeriod
    .filter((r) => (show === "all" || r.status === show) && matches(query, r.patientName, r.number, r.invoiceNumber, r.reason))
    .sort((a, b) => b.createdAt - a.createdAt);
  const sum = (st: Refund["status"]) => inPeriod.filter((r) => r.status === st).reduce((s, r) => s + r.amount, 0);
  const count = (st: Refund["status"]) => inPeriod.filter((r) => r.status === st).length;

  function decide(r: Refund, approve: boolean) {
    const note = approve ? undefined : (window.prompt("سبب الرفض (اختياري):") ?? undefined);
    if (decideRefund(r.id, approve, note)) toast.success(approve ? "تم اعتماد المرتجع — يصرفه موظف الخزينة للمريض." : "تم رفض طلب المرتجع.");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="دورة الإيرادات"
        title="مرتجعات المرضى"
        description="لو المريض لغى خدمة بعد ما دفع: افتح الإيصال من صفحة الإيصالات واختر «مرتجع للمريض». يعتمده المدير المالي، ثم يُصرف المبلغ من الخزينة الرئيسية ويُخصم من إيراد القسم تلقائيًا، والأدوية ترجع للمخزن."
        actions={
          <Button variant="outline" asChild>
            <Link to="/billing">
              <Receipt /> إيصالات المرضى
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="بانتظار الاعتماد" value={int(count("pending"))} icon={Clock} tone="copper" hint={`${money(sum("pending"))} ج.م`} />
        <StatCard label="معتمد — لم يُصرف بعد" value={int(count("approved"))} icon={Check} tone="primary" hint={`${money(sum("approved"))} ج.م`} />
        <StatCard label="رُدّ للمرضى" value={money(sum("paid"))} icon={Banknote} tone="expense" hint={`${int(count("paid"))} مرتجع`} />
        <StatCard label="مرفوض" value={int(count("rejected"))} icon={X} />
      </div>

      <div className="ledger-card mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <MonthYearPicker period={period} onChange={setPeriod} allowAll />
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="حالة المرتجع">
            {(["all", "pending", "approved", "paid", "rejected"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)} className={cn("chip-filter", show === k && "chip-filter-active")}>
                {k === "all" ? "الكل" : STATUS_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder="اسم المريض أو رقم الإيصال" className="sm:w-72" />
      </div>

      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>رقم المرتجع</Th>
            <Th>المريض والخدمات</Th>
            <Th>القسم</Th>
            <Th num>المبلغ</Th>
            <Th>الحالة</Th>
            <Th className="text-left">إجراءات</Th>
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mine = r.requestedById === me?.id;
            const manager = !!me && canSpendDirectly(me);
            return (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td className="font-mono text-xs">
                  <span dir="ltr">{r.number}</span>
                  <p className="font-sans text-[11px] text-muted-foreground">{dateLabel(r.date)}</p>
                </Td>
                <Td>
                  <p className="font-semibold">{r.patientName}</p>
                  <p className="text-xs text-muted-foreground">
                    إيصال <span dir="ltr">{r.invoiceNumber}</span> — {r.lines.map((l) => `${l.description} (${int(l.qty)})`).join("، ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">السبب: {r.reason} — طلبه {r.requestedBy}</p>
                </Td>
                <Td>
                  <DeptBadge id={r.department} />
                </Td>
                <Td num className="font-bold text-expense">{money(r.amount)}</Td>
                <Td>
                  <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
                  {r.status === "paid" && r.boxId && <p className="mt-1 text-[11px] text-muted-foreground">من {findBox(db, r.boxId).name}</p>}
                  {r.decisionNote && <p className="mt-1 text-[11px] text-muted-foreground">{r.decisionNote}</p>}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {r.status === "pending" && canApprove(r) && (
                      <>
                        <Button size="sm" className="px-2" onClick={() => decide(r, true)}>
                          <Check /> اعتماد
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2 text-destructive" onClick={() => decide(r, false)}>
                          <X /> رفض
                        </Button>
                      </>
                    )}
                    {r.status === "approved" && canAdd && (
                      <Button size="sm" className="px-2" onClick={() => setPaying(r)}>
                        <Undo2 /> صرف للمريض
                      </Button>
                    )}
                    {(r.status === "paid" ? manager : mine || manager) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف المرتجع ${r.number}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (window.confirm(r.status === "paid" ? "حذف المرتجع المصروف؟ سيُلغى قيده من الخزينة." : "حذف طلب المرتجع؟"))
                            if (deleteRefund(r.id)) toast.success("تم الحذف.");
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
          {!rows.length && <EmptyRow cols={6} text="لا توجد مرتجعات في هذه الفترة. يبدأ المرتجع من قائمة خيارات الإيصال في صفحة الإيصالات." />}
        </tbody>
      </TableCard>

      <PayMoneyDialog
        open={!!paying}
        onOpenChange={(o) => !o && setPaying(null)}
        title="صرف المرتجع للمريض"
        description={paying ? `${paying.patientName} — إيصال ${paying.invoiceNumber}` : ""}
        amount={paying?.amount ?? 0}
        onPay={(a) => {
          if (!paying) return false;
          const ok = payRefund({ id: paying.id, date: a.date, boxId: a.boxId, method: a.method });
          if (ok) toast.success("تم رد المبلغ للمريض وخصمه من إيراد القسم.");
          return ok;
        }}
      />
    </div>
  );
}
