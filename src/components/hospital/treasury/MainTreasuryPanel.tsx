import { ArrowDownLeft, ArrowUpRight, Timer, Users, Vault } from "lucide-react";
import { useMemo, useState } from "react";
import { BoxSelect, EmptyRow, HeadRow, TableCard, Td, Th } from "@/components/hospital/kit";
import { isoDate, money, monthLabel } from "@/lib/hospital/format";
import { ICU_BOX_ID, MAIN_BOX_ID } from "@/lib/hospital/model";
import { listLabel, useHospitalDB } from "@/lib/hospital/store";
import { boxTreasurySummary, type Range } from "@/lib/hospital/treasury-summary";
import { cn } from "@/lib/utils";

/** Range of a ledger period ("YYYY-MM" or "all"). */
export function periodRange(period: string): Range {
  if (period === "all") return { from: "0000-01-01", to: "9999-12-31" };
  const [y, m] = period.split("-").map(Number) as [number, number];
  return { from: `${period}-01`, to: `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
}

/**
 * The one main treasury: its balance now, today's movement, open shifts, and how much each person
 * collected (today or in the chosen month), with shift shortages/surpluses on their name.
 */
export function MainTreasuryPanel({ period }: { period: string }) {
  const db = useHospitalDB();
  const today = isoDate(new Date());
  const [span, setSpan] = useState<"today" | "period">("today");
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const range = span === "today" ? { from: today, to: today } : periodRange(period);
  const sum = useMemo(() => boxTreasurySummary(db, range, boxId), [db, range.from, range.to, boxId]); // eslint-disable-line react-hooks/exhaustive-deps
  const todaySum = useMemo(() => boxTreasurySummary(db, { from: today, to: today }, boxId), [db, today, boxId]);
  const icuBalance = useMemo(
    () => boxTreasurySummary(db, { from: "0000-01-01", to: "9999-12-31" }, ICU_BOX_ID).balance,
    [db],
  );
  const boxName = db.cashboxes.find((b) => b.id === boxId)?.name ?? "الخزينة";
  const methods = Object.keys(sum.byMethod);
  const totals = sum.collectors.reduce(
    (t, r) => ({ count: t.count + r.count, collected: t.collected + r.collected, paidOut: t.paidOut + r.paidOut, short: t.short + r.shortage, surplus: t.surplus + r.surplus, net: t.net + r.net }),
    { count: 0, collected: 0, paidOut: 0, short: 0, surplus: 0, net: 0 },
  );
  const spanLabel = span === "today" ? "اليوم" : period === "all" ? "كل الفترات" : `شهر ${monthLabel(period)}`;

  return (
    <section className="mb-6 grid gap-4" aria-label="الخزينة الرئيسية">
      <div className="hero-banner p-5">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="hero-chip">
              <Vault className="size-3.5" /> {boxName}
            </span>
            <p className="mt-3 text-xs opacity-80">رصيد {boxName} الآن</p>
            <p className="num font-display text-3xl font-bold tracking-tight">{money(sum.balance)} ج.م</p>
            <p className="mt-1 text-xs opacity-75">
              خزنة العناية المركزة: <strong className="num">{money(icuBalance)}</strong> ج.م
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="hero-chip">
              <ArrowDownLeft className="size-3.5" /> دخل اليوم {money(todaySum.periodIn)}
            </span>
            <span className="hero-chip">
              <ArrowUpRight className="size-3.5" /> خرج اليوم {money(todaySum.periodOut)}
            </span>
            <span className="hero-chip">
              <Timer className="size-3.5" /> ورديات مفتوحة {sum.openShifts.length}
            </span>
            <BoxSelect value={boxId} onChange={setBoxId} cashOnly className="w-44" />
          </div>
        </div>
        <p className="relative z-10 mt-3 text-[11px] opacity-75">
          كل موظف بيحصّل في ورديته على خزنة قسمه: العناية على خزنة العناية، وباقي الأقسام على الرئيسية.
          النثريات والمصروفات بتتصرف من الخزينة المختارة، والحسابات البنكية لوحدها.
        </p>
      </div>

      <div className="ledger-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/60 px-4 py-3">
          <h2 className="flex items-center gap-2 font-bold">
            <Users className="size-4" /> مين حصّل كام — {spanLabel}
          </h2>
          <div className="flex gap-1.5" role="group" aria-label="فترة التحصيل">
            <button type="button" className={cn("chip-filter", span === "today" && "chip-filter-active")} onClick={() => setSpan("today")}>
              اليوم
            </button>
            <button type="button" className={cn("chip-filter", span === "period" && "chip-filter-active")} onClick={() => setSpan("period")}>
              الفترة المختارة في الدفتر
            </button>
          </div>
        </div>
        <TableCard minWidth={860}>
          <thead>
            <HeadRow>
              <Th>الموظف</Th>
              <Th num>عدد الإيصالات</Th>
              <Th num>المحصَّل</Th>
              {methods.length > 1 && <Th>حسب طريقة الدفع</Th>}
              <Th num>صرف من الخزينة</Th>
              <Th num>عجز</Th>
              <Th num>زيادة</Th>
              <Th num>الصافي للخزينة</Th>
              <Th>الوردية</Th>
            </HeadRow>
          </thead>
          <tbody>
            {sum.collectors.map((r) => (
              <tr key={r.key} className="border-b last:border-0 hover:bg-muted/50">
                <Td className="font-semibold">{r.name}</Td>
                <Td num>{r.count}</Td>
                <Td num className="font-semibold text-income">{money(r.collected)}</Td>
                {methods.length > 1 && (
                  <Td className="text-[11px] text-muted-foreground">
                    {Object.entries(r.byMethod)
                      .map(([m, v]) => `${listLabel(db.lists.paymentMethods, m)} ${money(v)}`)
                      .join(" • ") || "—"}
                  </Td>
                )}
                <Td num className="text-expense">{r.paidOut ? money(r.paidOut) : "—"}</Td>
                <Td num className="text-destructive">{r.shortage ? money(r.shortage) : "—"}</Td>
                <Td num className="text-income">{r.surplus ? money(r.surplus) : "—"}</Td>
                <Td num className="font-bold">{money(r.net)}</Td>
                <Td className="text-[11px]">
                  {r.openShift ? (
                    <span className="rounded-full bg-income/10 px-2 py-0.5 text-income">مفتوحة (رقم {r.openShift.number})</span>
                  ) : r.key.startsWith("u:") ? (
                    <span className="text-muted-foreground">مقفولة</span>
                  ) : (
                    <span className="text-muted-foreground">بدون وردية (إدارة)</span>
                  )}
                </Td>
              </tr>
            ))}
            {!sum.collectors.length && <EmptyRow cols={methods.length > 1 ? 9 : 8} text={`مفيش تحصيل ${spanLabel}.`} />}
            {sum.collectors.length > 0 && (
              <tr className="border-t-2 bg-muted/40 font-bold">
                <Td>الإجمالي</Td>
                <Td num>{totals.count}</Td>
                <Td num className="text-income">{money(totals.collected)}</Td>
                {methods.length > 1 && (
                  <Td className="text-[11px] text-muted-foreground">
                    {methods.map((m) => `${listLabel(db.lists.paymentMethods, m)} ${money(sum.byMethod[m] ?? 0)}`).join(" • ")}
                  </Td>
                )}
                <Td num className="text-expense">{money(totals.paidOut)}</Td>
                <Td num className="text-destructive">{money(totals.short)}</Td>
                <Td num className="text-income">{money(totals.surplus)}</Td>
                <Td num>{money(totals.net)}</Td>
                <Td />
              </tr>
            )}
          </tbody>
        </TableCard>
      </div>
    </section>
  );
}
