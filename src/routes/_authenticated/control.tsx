import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, ShieldAlert, ShieldCheck, UserCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { EmptyRow, HeadRow, TableCard, Td, Th } from "@/components/hospital/kit";
import { RangePicker, thisMonth, type Range } from "@/components/hospital/accounting/RangePicker";
import { ALERT_LABELS, BIG_DISCOUNT_PCT, controlAlerts, moneyTrail, personSummary, type AlertKind } from "@/lib/hospital/control";
import { dateLabel, isoDate, money } from "@/lib/hospital/format";
import { TX_SOURCE_LABELS, useCan, useHospitalDB, type TxSource } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/control")({
  head: () => ({
    meta: [
      { title: "الرقابة ومنع التلاعب | مستشفى الرحمة التخصصي" },
      { name: "description", content: "كل جنيه داخل وخارج، والإيصالات الملغاة، وعجز الورديات، والخصومات الكبيرة في مكان واحد." },
      { property: "og:title", content: "الرقابة ومنع التلاعب | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تنبيهات الرقابة على الخزائن والإيصالات لكل موظف." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ControlPage,
});

const RULES = [
  "مفيش موظف يلغي إيصال عمله — الإلغاء بطلب يوافق عليه المدير المالي، وطلبات المدير المالي نفسه يوافق عليها مدير المستشفى.",
  "الإيصال بعد طباعته مايتعدلش إلا بموافقة، والتعديل يتسجل باسم اللي طلبه واللي وافق.",
  "أي إذن صرف أو مصروف أو نثرية أو مرتجع أو سلفة من غير المدير المالي بيتعمل كطلب ومايتصرفش إلا بعد موافقته.",
  "اللي يقدّم الطلب عمره ما يوافق عليه بنفسه.",
  "الفلوس كلها في خزينة رئيسية واحدة: كل موظف بيحصّل في ورديته هو، والتقفيل بعدّ الفلوس والعجز بيتسجل باسمه.",
  "لكل موظف حد أقصى للخصم بتحدده من صفحة المستخدمين.",
  "كل عملية بتتسجل في سجل العمليات بالاسم والوقت، ومفيش حاجة بتتمسح من السجل.",
];

function ControlPage() {
  const db = useHospitalDB();
  const allowed = useCan("approvals", "view");
  const [range, setRange] = useState<Range>(thisMonth);
  const [kind, setKind] = useState<AlertKind | "all">("all");
  const today = isoDate(new Date());

  const alerts = useMemo(() => controlAlerts(db, range.from, range.to, today), [db, range, today]);
  const people = useMemo(() => personSummary(db, alerts, range.from, range.to), [db, alerts, range]);
  const trail = useMemo(() => moneyTrail(db, range.from, range.to), [db, range]);
  const shown = kind === "all" ? alerts : alerts.filter((a) => a.kind === kind);
  const counts = useMemo(() => {
    const c: Partial<Record<AlertKind, number>> = {};
    for (const a of alerts) c[a.kind] = (c[a.kind] ?? 0) + 1;
    return c;
  }, [alerts]);
  const high = alerts.filter((a) => a.level === "high").length;
  const shortages = alerts.filter((a) => a.kind === "shortage").reduce((s, a) => s + a.amount, 0);

  if (!allowed)
    return (
      <div className="ledger-card mx-auto max-w-lg p-10 text-center text-muted-foreground">
        الصفحة دي لمدير المستشفى والمدير المالي والمراجع فقط.
      </div>
    );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow="الرقابة"
        title="الرقابة ومنع التلاعب"
        description="كل جنيه دخل منين وراح فين، وكل حركة ممكن تخبّي تلاعب: إيصالات اتلغت أو اتعدلت، عجز في الورديات، خصومات كبيرة، إيصالات اتحصلت ومطبعتش، وصرف من غير أمر صرف."
        actions={<RangePicker value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="فلوس دخلت" value={money(trail.totalIn)} icon={ArrowDownLeft} tone="income" />
        <StatCard label="فلوس خرجت" value={money(trail.totalOut)} icon={ArrowUpRight} tone="expense" />
        <StatCard label="تنبيهات مهمة" value={high} hint={`من ${alerts.length} تنبيه`} icon={ShieldAlert} tone={high ? "expense" : "default"} />
        <StatCard label="عجز الورديات" value={money(shortages)} icon={AlertTriangle} tone={shortages ? "copper" : "default"} />
      </div>

      <section className="ledger-card p-5">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <ShieldCheck className="size-5 text-primary" /> الحماية الشغالة على السيستم
        </h2>
        <ul className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          {RULES.map((r) => (
            <li key={r} className="flex gap-2 leading-relaxed">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-income" />
              {r}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="ml-2 font-display text-lg font-bold">التنبيهات</h2>
          <button type="button" className={cn("chip-filter", kind === "all" && "chip-filter-active")} onClick={() => setKind("all")}>
            الكل ({alerts.length})
          </button>
          {(Object.keys(ALERT_LABELS) as AlertKind[])
            .filter((k) => counts[k])
            .map((k) => (
              <button key={k} type="button" className={cn("chip-filter", kind === k && "chip-filter-active")} onClick={() => setKind(k)}>
                {ALERT_LABELS[k]} ({counts[k]})
              </button>
            ))}
        </div>
        <TableCard minWidth={820}>
          <thead>
            <HeadRow>
              <Th>النوع</Th>
              <Th>التاريخ</Th>
              <Th>الموظف</Th>
              <Th>التفاصيل</Th>
              <Th num>المبلغ</Th>
            </HeadRow>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className="border-b last:border-0 hover:bg-muted/50">
                <Td>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", a.level === "high" ? "bg-expense/10 text-expense" : "bg-copper/15 text-copper")}>
                    {ALERT_LABELS[a.kind]}
                  </span>
                </Td>
                <Td className="text-xs whitespace-nowrap">{dateLabel(a.date)}</Td>
                <Td className="font-semibold">{a.person}</Td>
                <Td>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.detail}</p>
                </Td>
                <Td num>{a.amount ? money(a.amount) : "—"}</Td>
              </tr>
            ))}
            {!shown.length && <EmptyRow cols={5} text="مفيش تنبيهات في الفترة دي — كل الحركات ماشية طبيعي." />}
          </tbody>
        </TableCard>
        <p className="text-[11px] text-muted-foreground">
          الخصم بيظهر هنا لو وصل {BIG_DISCOUNT_PCT}٪ أو أكتر من قيمة الإيصال. الإيصال اللي اتسجل ومطبعش بيظهر من تاني يوم.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <UserCheck className="size-5 text-primary" /> كل موظف: حصّل كام وعليه إيه
        </h2>
        <TableCard minWidth={760}>
          <thead>
            <HeadRow>
              <Th>الموظف</Th>
              <Th num>عدد الإيصالات</Th>
              <Th num>حصّل</Th>
              <Th num>خصومات</Th>
              <Th num>إيصالات اتلغت</Th>
              <Th num>عجز</Th>
              <Th num>تنبيهات</Th>
            </HeadRow>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.person} className="border-b last:border-0 hover:bg-muted/50">
                <Td className="font-semibold">{p.person}</Td>
                <Td num>{p.receipts}</Td>
                <Td num className="text-income">{money(p.collected)}</Td>
                <Td num>{money(p.discounts)}</Td>
                <Td num>{money(p.cancelled)}</Td>
                <Td num className={p.shortages ? "text-expense" : ""}>{money(p.shortages)}</Td>
                <Td num>
                  <span className={cn("font-bold", p.alerts ? "text-expense" : "text-muted-foreground")}>{p.alerts}</span>
                </Td>
              </tr>
            ))}
            {!people.length && <EmptyRow cols={7} text="مفيش حركات في الفترة دي." />}
          </tbody>
        </TableCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <TrailCard title="الفلوس دخلت منين" rows={trail.inBy} total={trail.totalIn} tone="income" />
        <TrailCard title="الفلوس راحت فين" rows={trail.outBy} total={trail.totalOut} tone="expense" />
      </section>
      <p className="text-sm text-muted-foreground">
        تحويلات بين الخزينة الرئيسية والحسابات البنكية في الفترة: {trail.transferCount} تحويل بإجمالي {money(trail.transfers)} — دي فلوس بتتنقل جوه المستشفى ومش بتخرج.
      </p>
    </div>
  );
}

function TrailCard({ title, rows, total, tone }: { title: string; rows: [string, number][]; total: number; tone: "income" | "expense" }) {
  return (
    <div className="ledger-card p-5">
      <h3 className="font-display font-bold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {rows.map(([src, amount]) => (
          <li key={src} className="flex items-center gap-3">
            <span className="w-36 shrink-0">{TX_SOURCE_LABELS[src as TxSource] ?? src}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span className={cn("block h-full rounded-full", tone === "income" ? "bg-income" : "bg-expense")} style={{ width: `${total ? Math.max(2, (amount / total) * 100) : 0}%` }} />
            </span>
            <span className="num w-28 shrink-0 text-left font-semibold">{money(amount)}</span>
          </li>
        ))}
        {!rows.length && <li className="text-muted-foreground">مفيش حركة.</li>}
      </ul>
    </div>
  );
}
