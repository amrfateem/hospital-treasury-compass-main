import { createFileRoute, Link } from "@tanstack/react-router";
import { BedDouble, LogOut, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, HeadRow, matches, SearchBox, TableCard, Td, Th } from "@/components/hospital/kit";
import { AdmissionAccount } from "@/components/hospital/admissions/AdmissionAccount";
import { NewAdmissionDialog } from "@/components/hospital/admissions/NewAdmissionDialog";
import { dateLabel, int, isoDate, money, periodOf } from "@/lib/hospital/format";
import { admissionBill, depositsOf } from "@/lib/hospital/inpatient";
import { deleteAdmission, useCan, useHospitalDB } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admissions")({
  head: () => ({
    meta: [
      { title: "حساب المريض المقيم | مستشفى الرحمة التخصصي" },
      { name: "description", content: "حساب واحد للمريض المقيم: تأمين عند الدخول، وكل خدمة ودواء ويوم إقامة يتضاف عليه، وفاتورة نهائية واحدة عند الخروج." },
      { property: "og:title", content: "حساب المريض المقيم | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "التأمين المقدم والخدمات أثناء الإقامة والفاتورة النهائية عند الخروج." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdmissionsPage,
});

function AdmissionsPage() {
  const db = useHospitalDB();
  const canAdd = useCan("billing", "add");
  const [show, setShow] = useState<"open" | "discharged">("open");
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const today = isoDate(new Date());
  const month = periodOf(new Date());

  const rows = useMemo(
    () =>
      db.admissions
        .filter((a) => a.status === show && matches(query, a.patientName, a.number, a.patientMrn, a.room))
        .map((a) => ({ a, bill: admissionBill(a, today), deposits: depositsOf(db.transactions, a.id) }))
        .sort((x, y) => (show === "open" ? x.a.date.localeCompare(y.a.date) : (y.a.dischargeDate ?? "").localeCompare(x.a.dischargeDate ?? ""))),
    [db.admissions, db.transactions, show, query, today],
  );
  const openOnes = db.admissions.filter((a) => a.status === "open");
  const held = openOnes.reduce((s, a) => s + depositsOf(db.transactions, a.id), 0);
  const running = openOnes.reduce((s, a) => s + admissionBill(a, today).patientShare, 0);
  const outThisMonth = db.admissions.filter((a) => a.status === "discharged" && a.dischargeDate?.startsWith(month)).length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="دورة الإيرادات"
        title="حساب المريض المقيم"
        description="المريض بيدفع تأمين وهو داخل، وكل خدمة أو دواء أو يوم إقامة بيتسجل على حسابه، ولما يخرج بتطلعله فاتورة واحدة نهائية والتأمين بيتخصم منها."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/billing">
                <Receipt /> إيصالات المرضى
              </Link>
            </Button>
            {canAdd && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> دخول مريض
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="مقيمون حاليًا" value={int(openOnes.length)} icon={BedDouble} tone="primary" />
        <StatCard label="تأمينات محصّلة (للمقيمين)" value={money(held)} icon={Wallet} tone="income" hint="تُخصم من فواتيرهم عند الخروج" />
        <StatCard label="حسابات المقيمين حتى اليوم" value={money(running)} icon={Receipt} hint="المطلوب من المرضى" />
        <StatCard label="خروج هذا الشهر" value={int(outThisMonth)} icon={LogOut} />
      </div>

      <div className="ledger-card mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-1" role="tablist" aria-label="عرض الحسابات">
          {(["open", "discharged"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)} className={cn("chip-filter", show === k && "chip-filter-active")}>
              {k === "open" ? "المقيمون حاليًا" : "خرجوا"}
            </button>
          ))}
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder="اسم المريض أو رقم الملف أو الغرفة" className="sm:w-80" />
      </div>

      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>رقم الحساب</Th>
            <Th>المريض</Th>
            <Th>القسم والغرفة</Th>
            <Th>{show === "open" ? "مدة الإقامة" : "الخروج"}</Th>
            <Th num>الحساب</Th>
            <Th num>التأمين</Th>
            <Th num>{show === "open" ? "الباقي" : "الفاتورة"}</Th>
            <Th className="text-left">إجراءات</Th>
          </HeadRow>
        </thead>
        <tbody>
          {rows.map(({ a, bill, deposits }) => {
            const rest = bill.patientShare - deposits;
            const inv = a.invoiceId ? db.patientInvoices.find((i) => i.id === a.invoiceId) : undefined;
            return (
              <tr key={a.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => setCurrent(a.id)}>
                <Td className="font-mono text-xs">
                  <span dir="ltr">{a.number}</span>
                </Td>
                <Td>
                  <p className="font-semibold">{a.patientName}</p>
                  {a.patientMrn && <p className="num text-[11px] text-muted-foreground" dir="ltr">{a.patientMrn}</p>}
                </Td>
                <Td>
                  <DeptBadge id={a.ward} />
                  {a.room && <p className="mt-1 text-[11px] text-muted-foreground">غرفة {a.room}</p>}
                </Td>
                <Td>
                  {show === "open" ? (
                    <>
                      <b className="num">{int(bill.days)}</b> يوم
                      <p className="text-[11px] text-muted-foreground">منذ {dateLabel(a.date)}</p>
                    </>
                  ) : (
                    dateLabel(a.dischargeDate ?? "")
                  )}
                </Td>
                <Td num>{money(bill.total)}</Td>
                <Td num className="text-income">{money(deposits)}</Td>
                <Td num>
                  {show === "open" ? (
                    <span className={cn("font-bold", rest > 0 ? "text-expense" : "text-income")}>{rest >= 0 ? money(rest) : `يُرد ${money(-rest)}`}</span>
                  ) : (
                    <span dir="ltr" className="font-mono text-xs">{inv?.number ?? "—"}</span>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" className="px-2" onClick={() => setCurrent(a.id)}>
                      <BedDouble /> فتح الحساب
                    </Button>
                    {canAdd && a.status === "open" && !a.charges.length && !deposits && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف الحساب ${a.number}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => window.confirm("حذف حساب الإقامة الفارغ؟") && deleteAdmission(a.id) && toast.success("تم الحذف.")}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow cols={8} text={show === "open" ? "لا يوجد مرضى مقيمون حاليًا. اضغط «دخول مريض» لفتح حساب." : "لا توجد حسابات خروج بعد."} />}
        </tbody>
      </TableCard>

      <NewAdmissionDialog open={newOpen} onOpenChange={setNewOpen} onOpened={setCurrent} />
      <AdmissionAccount admissionId={current} onOpenChange={(o) => !o && setCurrent(null)} />
    </div>
  );
}
