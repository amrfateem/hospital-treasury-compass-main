import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarCheck,
  Check,
  FileDown,
  Lock,
  LockOpen,
  ShieldAlert,
  Wallet,
  X,
} from "lucide-react";
import { useMemo, useState, type RefObject } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { BoxSelect, EmptyRow, FieldRow, HeadRow, TableCard, Td, Th, usePdfExport } from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import {
  closeDayBlocker,
  closedThrough,
  closingOf,
  dayReport,
  unclosedDays,
  type DayReport,
} from "@/lib/hospital/daily-closing";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import { findBox, listLabel, MAIN_BOX_ID, type DailyClosing, type DayClosingLine } from "@/lib/hospital/model";
import { canApprove } from "@/lib/hospital/permissions";
import {
  closeCashDay,
  decideDayReopen,
  flushPending,
  requestDayReopen,
  useCan,
  useHospitalDB,
  useHospitalSession,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/daily-closing")({
  head: () => ({
    meta: [
      { title: "الإقفال اليومي للخزينة الرئيسية | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "تقرير إقفال يومي مطبوع: رصيد أول اليوم + الوارد − المنصرف = رصيد آخر اليوم، مع النقدية المعدودة ومين حصّل كام وتوقيع أمين الخزينة والمدير المالي.",
      },
      { property: "og:title", content: "الإقفال اليومي للخزينة | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "إقفال يومي للخزينة الرئيسية — اليوم المقفول لا يُعدَّل إلا بموافقة المدير المالي.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DailyClosingPage,
});

function DailyClosingPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canClose = useCan("treasury", "add");
  const today = isoDate(new Date());
  const [boxId, setBoxId] = useState(MAIN_BOX_ID);
  const waiting = unclosedDays(db, today, boxId);
  const through = closedThrough(db, boxId);
  const [date, setDate] = useState(() => waiting[0] ?? today);
  const [closingOpen, setClosingOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const report = useMemo(() => dayReport(db, date, boxId), [db, date, boxId]);
  const record = closingOf(db, date, boxId);
  const locked = !!through && date <= through;
  const blocker = closeDayBlocker(db, date, today, boxId);
  const history = useMemo(
    () =>
      db.dailyClosings
        .filter((c) => (c.boxId ?? MAIN_BOX_ID) === boxId)
        .sort((a, b) => b.date.localeCompare(a.date) || b.closedAt - a.closedAt),
    [db.dailyClosings, boxId],
  );
  const pending = record?.reopen?.status === "pending" ? record : undefined;
  const mayDecide = !!pending && !!me && canApprove(me, pending.reopen!);
  const isLatest = !!record && record.date === through;
  const pdf = usePdfExport();
  const methodName = (id: string) => listLabel(db.lists.paymentMethods, id);

  async function decide(approve: boolean) {
    if (!pending) return;
    if (decideDayReopen(pending.id, approve)) {
      await flushPending();
      toast.success(approve ? `تمت إعادة فتح يوم ${dateLabel(pending.date)}.` : "تم رفض طلب إعادة الفتح، واليوم ما زال مقفولًا.");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="الخزائن النقدية"
        title="الإقفال اليومي لكل خزنة"
        description="كل خزنة (الرئيسية أو العناية) تُقفل أيامها لوحدها: رصيد أول اليوم + الوارد − المنصرف = رصيد آخر اليوم، وتُقارن بالنقدية المعدودة. بعد الإقفال لا تتعدل حركة تلك الخزنة في اليوم المقفول إلا بعد موافقة المدير المالي على إعادة فتحه."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <FieldRow label="الخزينة">
              <BoxSelect
                value={boxId}
                onChange={(v) => {
                  setBoxId(v);
                  const next = unclosedDays(db, today, v);
                  setDate(next[0] ?? today);
                }}
                cashOnly
                className="w-44"
              />
            </FieldRow>
            <FieldRow label="اليوم" htmlFor="dc-date">
              <Input id="dc-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
            </FieldRow>
            <Button
              variant="outline"
              disabled={pdf.busy}
              onClick={() => pdf.run(`إقفال-يومي-${date}.pdf`, "تم تنزيل تقرير الإقفال اليومي.")}
            >
              <FileDown /> طباعة التقرير PDF
            </Button>
          </div>
        }
      />

      {waiting.length > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-copper/60 bg-copper/5 px-3 py-2 text-sm">
          <ShieldAlert className="size-4 shrink-0 text-copper" />
          {waiting.length === 1
            ? `يوم ${dateLabel(waiting[0]!)} فيه حركات ولم يُقفل بعد.`
            : `${int(waiting.length)} أيام فيها حركات ولم تُقفل بعد — أقدمها ${dateLabel(waiting[0]!)}.`}
          {date !== waiting[0] && (
            <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setDate(waiting[0]!)}>
              اعرض {dateLabel(waiting[0]!)}
            </Button>
          )}
        </p>
      )}

      <section className="ledger-card mb-6 p-4" aria-labelledby="dc-state">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="dc-state" className="flex items-center gap-2 text-lg font-bold">
              <CalendarCheck className="size-5 text-primary" /> يوم {dateLabel(date)}
            </h2>
            {record ? (
              <p className="text-sm text-muted-foreground">
                <Lock className="me-1 inline size-3.5" />
                مقفول — أقفله {record.closedBy} في {new Date(record.closedAt).toLocaleString("ar-EG")}
              </p>
            ) : locked ? (
              <p className="text-sm text-muted-foreground">
                <Lock className="me-1 inline size-3.5" /> لا توجد حركات في هذا اليوم، وهو داخل الفترة المقفولة حتى {dateLabel(through!)}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">مفتوح — الأرقام تتغير مع كل حركة جديدة حتى يُقفل.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!record && !locked && canClose && (
              <Button onClick={() => setClosingOpen(true)} disabled={!!blocker} title={blocker ?? undefined}>
                <Lock /> إقفال اليوم
              </Button>
            )}
            {record && isLatest && canClose && !pending && (
              <Button variant="ghost" className="text-destructive" onClick={() => setReopenOpen(true)}>
                <LockOpen /> {me?.role === "admin" ? "إعادة فتح اليوم" : "طلب إعادة فتح"}
              </Button>
            )}
          </div>
        </div>
        {!record && !locked && blocker && canClose && (
          <p className="mt-2 text-sm text-expense">{blocker}</p>
        )}
        {pending && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-copper/10 px-3 py-2 text-sm">
            <span>
              طلب إعادة فتح من {pending.reopen!.requestedBy} — السبب: {pending.reopen!.reason}. بانتظار اعتماد المدير المالي.
            </span>
            {mayDecide && (
              <span className="flex gap-2">
                <Button size="sm" onClick={() => decide(true)}>
                  <Check /> موافقة
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide(false)}>
                  <X /> رفض
                </Button>
              </span>
            )}
          </div>
        )}
        {record?.reopen?.status === "rejected" && (
          <p className="mt-2 text-xs text-muted-foreground">
            طلب إعادة فتح سابق رفضه {record.reopen.decidedBy}
            {record.reopen.note ? ` — ${record.reopen.note}` : ""}.
          </p>
        )}
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="رصيد أول اليوم" value={money(record?.opening ?? report.opening)} icon={Wallet} />
        <StatCard label="الوارد (+)" value={money(record?.totalIn ?? report.totalIn)} icon={ArrowDownLeft} tone="income" />
        <StatCard label="المنصرف (−)" value={money(record?.totalOut ?? report.totalOut)} icon={ArrowUpRight} tone="expense" />
        <StatCard
          label="رصيد آخر اليوم (=)"
          value={money(record?.closing ?? report.closing)}
          icon={CalendarCheck}
          tone="primary"
          hint={`منها نقدية ${money(record?.expectedCash ?? report.expectedCash)}`}
        />
      </div>

      {record && (
        <section className="ledger-card mb-6 grid gap-3 p-4 sm:grid-cols-3" aria-label="النقدية المعدودة">
          <div>
            <p className="text-xs text-muted-foreground">النقدية المتوقعة في الخزينة</p>
            <p className="num text-lg font-bold">{money(record.expectedCash)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">النقدية المعدودة فعليًا</p>
            <p className="num text-lg font-bold">{money(record.counted)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{record.difference < 0 ? "عجز" : record.difference > 0 ? "زيادة" : "الفرق"}</p>
            <p className={cn("num text-lg font-bold", record.difference < 0 && "text-expense", record.difference > 0 && "text-income")}>
              {money(Math.abs(record.difference))}
            </p>
            {record.note && <p className="text-xs text-muted-foreground">السبب: {record.note}</p>}
          </div>
        </section>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <LinesCard title="الوارد للخزينة" lines={record?.inLines ?? report.inLines} total={record?.totalIn ?? report.totalIn} tone="income" />
        <LinesCard title="المنصرف من الخزينة" lines={record?.outLines ?? report.outLines} total={record?.totalOut ?? report.totalOut} tone="expense" />
      </div>

      <h2 className="mb-2 font-bold">رصيد آخر اليوم حسب طريقة الدفع</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        {Object.entries(record?.byMethod ?? report.byMethod).map(([m, v]) => (
          <span key={m} className="rounded-md border bg-card px-3 py-1.5 text-sm">
            {methodName(m)}: <span className="num font-semibold">{money(v)}</span>
          </span>
        ))}
        {!Object.keys(record?.byMethod ?? report.byMethod).length && <span className="text-sm text-muted-foreground">لا يوجد رصيد.</span>}
      </div>

      <h2 className="mb-2 font-bold">مين حصّل كام في اليوم ده</h2>
      <div className="mb-6">
        <TableCard minWidth={720}>
          <thead>
            <HeadRow>
              <Th>الموظف</Th>
              <Th num>عدد العمليات</Th>
              <Th num>المحصّل</Th>
              <Th num>المصروف منه</Th>
              <Th num>عجز</Th>
              <Th num>زيادة</Th>
              <Th num>الصافي للخزينة</Th>
            </HeadRow>
          </thead>
          <tbody>
            {(record?.collectors ?? report.collectors).map((c) => (
              <tr key={c.name} className="border-b last:border-0">
                <Td className="font-medium">{c.name}</Td>
                <Td num>{int(c.count)}</Td>
                <Td num className="text-income">{money(c.collected)}</Td>
                <Td num className="text-expense">{money(c.paidOut)}</Td>
                <Td num className={cn(c.shortage > 0 && "text-expense")}>{money(c.shortage)}</Td>
                <Td num>{money(c.surplus)}</Td>
                <Td num className="font-semibold">{money(c.net)}</Td>
              </tr>
            ))}
            {!(record?.collectors ?? report.collectors).length && <EmptyRow cols={7} text="لا توجد تحصيلات في هذا اليوم." />}
          </tbody>
        </TableCard>
      </div>

      <h2 className="mb-2 font-bold">حركات اليوم بالتفصيل ({int(report.entries.length)})</h2>
      <div className="mb-6">
        <EntriesTable report={report} />
      </div>

      <h2 className="mb-2 font-bold">سجل الإقفالات</h2>
      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>اليوم</Th>
            <Th num>أول اليوم</Th>
            <Th num>الوارد</Th>
            <Th num>المنصرف</Th>
            <Th num>آخر اليوم</Th>
            <Th num>المعدود</Th>
            <Th num>الفرق</Th>
            <Th>أقفله</Th>
            <Th>الحالة</Th>
          </HeadRow>
        </thead>
        <tbody>
          {history.map((c) => (
            <tr
              key={c.id}
              className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/40", c.date === date && c.status === "closed" && "bg-primary/5")}
              onClick={() => setDate(c.date)}
            >
              <Td className="num">{dateLabel(c.date)}</Td>
              <Td num>{money(c.opening)}</Td>
              <Td num className="text-income">{money(c.totalIn)}</Td>
              <Td num className="text-expense">{money(c.totalOut)}</Td>
              <Td num className="font-semibold">{money(c.closing)}</Td>
              <Td num>{money(c.counted)}</Td>
              <Td num className={cn(c.difference < 0 && "text-expense", c.difference > 0 && "text-income")}>{money(c.difference)}</Td>
              <Td>{c.closedBy}</Td>
              <Td>
                <StatusLabel c={c} />
              </Td>
            </tr>
          ))}
          {!history.length && <EmptyRow cols={9} text="لم يُقفل أي يوم بعد." />}
        </tbody>
      </TableCard>

      <CloseDialog open={closingOpen} date={date} boxId={boxId} report={report} onClose={() => setClosingOpen(false)} />
      <ReopenDialog open={reopenOpen} date={date} boxId={boxId} direct={me?.role === "admin"} onClose={() => setReopenOpen(false)} />
      <DayDocument pdfRef={pdf.ref} date={date} boxId={boxId} report={report} record={record} methodName={methodName} />
    </div>
  );
}

function StatusLabel({ c }: { c: DailyClosing }) {
  if (c.status === "reopened")
    return (
      <span className="text-xs text-expense">
        أُعيد فتحه ({c.reopen?.decidedBy}) — {c.reopen?.reason}
      </span>
    );
  if (c.reopen?.status === "pending") return <span className="text-xs text-copper">مقفول — طلب إعادة فتح بالانتظار</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Lock className="size-3" /> مقفول
    </span>
  );
}

function LinesCard({ title, lines, total, tone }: { title: string; lines: DayClosingLine[]; total: number; tone: "income" | "expense" }) {
  return (
    <section className="ledger-card p-4" aria-label={title}>
      <h2 className="mb-2 font-bold">{title}</h2>
      <ul className="divide-y text-sm">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center justify-between gap-2 py-1.5">
            <span>
              {l.label} <span className="text-xs text-muted-foreground">({int(l.count)})</span>
            </span>
            <span className="num">{money(l.amount)}</span>
          </li>
        ))}
        {!lines.length && <li className="py-3 text-center text-muted-foreground">لا يوجد.</li>}
        <li className={cn("flex justify-between pt-2 font-bold", tone === "income" ? "text-income" : "text-expense")}>
          <span>الإجمالي</span>
          <span className="num">{money(total)}</span>
        </li>
      </ul>
    </section>
  );
}

function EntriesTable({ report }: { report: DayReport }) {
  return (
    <TableCard minWidth={900}>
      <thead>
        <HeadRow>
          <Th>الوقت</Th>
          <Th>رقم المستند</Th>
          <Th>البيان</Th>
          <Th>النوع</Th>
          <Th>طريقة الدفع</Th>
          <Th>بواسطة</Th>
          <Th num>وارد</Th>
          <Th num>منصرف</Th>
        </HeadRow>
      </thead>
      <tbody>
        {report.entries.map((e) => (
          <tr key={e.id} className="border-b last:border-0">
            <Td className="num whitespace-nowrap">{new Date(e.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</Td>
            <Td className="num">{e.ref}</Td>
            <Td>{e.description}</Td>
            <Td>{e.type}</Td>
            <Td>{e.method}</Td>
            <Td>{e.by}</Td>
            <Td num className="text-income">{e.in ? money(e.in) : ""}</Td>
            <Td num className="text-expense">{e.out ? money(e.out) : ""}</Td>
          </tr>
        ))}
        {!report.entries.length && <EmptyRow cols={8} text="لا توجد حركات على الخزينة الرئيسية في هذا اليوم." />}
      </tbody>
    </TableCard>
  );
}

function CloseDialog({ open, date, boxId, report, onClose }: { open: boolean; date: string; boxId: string; report: DayReport; onClose: () => void }) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const n = counted.trim() === "" ? null : Number(counted);
  const diff = n === null || !Number.isFinite(n) ? null : Math.round((n - report.expectedCash) * 100) / 100;
  const needsNote = diff !== null && Math.abs(diff) > 0.001;

  async function confirm() {
    if (n === null || !Number.isFinite(n)) {
      toast.error("اكتب النقدية الفعلية اللي اتعدّت في الخزينة.");
      return;
    }
    setBusy(true);
    if (closeCashDay(date, n, note, boxId)) {
      await flushPending();
      toast.success(`تم إقفال يوم ${dateLabel(date)}. اطبع التقرير ووقّعه.`);
      setCounted("");
      setNote("");
      onClose();
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>إقفال يوم {dateLabel(date)}</DialogTitle>
          <DialogDescription>
            عدّ النقدية اللي في هذه الخزينة واكتبها. بعد الإقفال لا يمكن إضافة أو تعديل أو حذف أي حركة على نفس الخزينة بتاريخ اليوم ده أو قبله إلا بموافقة المدير المالي.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-3 text-sm">
          <dt className="text-muted-foreground">رصيد أول اليوم</dt>
          <dd className="num text-left">{money(report.opening)}</dd>
          <dt className="text-muted-foreground">+ الوارد</dt>
          <dd className="num text-left text-income">{money(report.totalIn)}</dd>
          <dt className="text-muted-foreground">− المنصرف</dt>
          <dd className="num text-left text-expense">{money(report.totalOut)}</dd>
          <dt className="font-semibold">= رصيد آخر اليوم</dt>
          <dd className="num text-left font-bold">{money(report.closing)}</dd>
          <dt className="text-muted-foreground">منها غير نقدي (فيزا / محافظ...)</dt>
          <dd className="num text-left">{money(report.nonCash)}</dd>
          <dt className="font-semibold">النقدية المتوقعة</dt>
          <dd className="num text-left font-bold">{money(report.expectedCash)}</dd>
        </dl>
        <FieldRow label="النقدية المعدودة فعليًا (ج.م)" htmlFor="dc-counted">
          <Input id="dc-counted" type="number" inputMode="decimal" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
        </FieldRow>
        {diff !== null && (
          <p className={cn("text-sm font-semibold", diff < 0 ? "text-expense" : diff > 0 ? "text-income" : "text-muted-foreground")}>
            {diff === 0 ? "مطابق — لا يوجد فرق." : `${diff < 0 ? "عجز" : "زيادة"} ${money(Math.abs(diff))} ج.م`}
          </p>
        )}
        <FieldRow label={needsNote ? "سبب الفرق (مطلوب)" : "ملاحظات (اختياري)"} htmlFor="dc-note">
          <Textarea id="dc-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </FieldRow>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={confirm} disabled={busy || n === null || (needsNote && !note.trim())}>
            <Lock /> تأكيد الإقفال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ open, date, boxId, direct, onClose }: { open: boolean; date: string; boxId: string; direct: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    if (requestDayReopen(date, reason, boxId)) {
      await flushPending();
      toast.success(direct ? `تمت إعادة فتح يوم ${dateLabel(date)}.` : "تم إرسال الطلب للمدير المالي.");
      setReason("");
      onClose();
    }
    setBusy(false);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>{direct ? "إعادة فتح" : "طلب إعادة فتح"} يوم {dateLabel(date)}</DialogTitle>
          <DialogDescription>
            {direct
              ? "بعد إعادة الفتح يمكن تصحيح حركات اليوم، ثم يجب إقفاله وطباعة تقريره من جديد. الإقفال القديم يفضل في السجل."
              : "الطلب يروح للمدير المالي. بعد موافقته يمكن تصحيح حركات اليوم، ثم يُقفل ويُطبع تقريره من جديد."}
          </DialogDescription>
        </DialogHeader>
        <FieldRow label="السبب" htmlFor="dc-reason">
          <Textarea id="dc-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </FieldRow>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || !reason.trim()}>
            <LockOpen /> {direct ? "إعادة الفتح" : "إرسال الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DayDocument({
  pdfRef,
  date,
  boxId,
  report,
  record,
  methodName,
}: {
  pdfRef: RefObject<HTMLDivElement | null>;
  date: string;
  boxId: string;
  report: DayReport;
  record: DailyClosing | undefined;
  methodName: (id: string) => string;
}) {
  const db = useHospitalDB();
  const f = record ?? report;
  return (
    <OfficialDocument
      ref={pdfRef}
      settings={db.settings}
      title={`تقرير الإقفال اليومي — ${findBox(db, boxId).name}`}
      subtitle={`يوم ${dateLabel(date)} — ${record ? `مقفول بواسطة ${record.closedBy} في ${new Date(record.closedAt).toLocaleString("ar-EG")}` : "لم يُقفل بعد (نسخة للمراجعة)"}`}
      issuedOn={dateLabel(isoDate(new Date()))}
    >
      <table className="doc-table">
        <tbody>
          <tr data-pdf-break>
            <td className="text-start">رصيد أول اليوم</td>
            <td>{money(f.opening)}</td>
          </tr>
          <tr data-pdf-break>
            <td className="text-start">+ إجمالي الوارد</td>
            <td>{money(f.totalIn)}</td>
          </tr>
          <tr data-pdf-break>
            <td className="text-start">− إجمالي المنصرف</td>
            <td>{money(f.totalOut)}</td>
          </tr>
          <tr className="doc-total" data-pdf-break>
            <td className="text-start">= رصيد آخر اليوم</td>
            <td>{money(f.closing)}</td>
          </tr>
          {Object.entries(f.byMethod).map(([m, v]) => (
            <tr key={m} data-pdf-break>
              <td className="text-start">منها {methodName(m)}</td>
              <td>{money(v)}</td>
            </tr>
          ))}
          <tr data-pdf-break>
            <td className="text-start">النقدية المتوقعة في الخزينة</td>
            <td>{money(f.expectedCash)}</td>
          </tr>
          <tr data-pdf-break>
            <td className="text-start">النقدية المعدودة فعليًا</td>
            <td>{record ? money(record.counted) : "................"}</td>
          </tr>
          <tr className="doc-subtotal" data-pdf-break>
            <td className="text-start">الفرق (عجز − / زيادة +){record?.note ? ` — ${record.note}` : ""}</td>
            <td>{record ? money(record.difference) : "................"}</td>
          </tr>
        </tbody>
      </table>

      <DocLines title="الوارد للخزينة" lines={f.inLines} total={f.totalIn} />
      <DocLines title="المنصرف من الخزينة" lines={f.outLines} total={f.totalOut} />

      <table className="doc-table" style={{ marginTop: 14 }}>
        <thead>
          <tr data-pdf-break>
            <th>الموظف</th>
            <th>العمليات</th>
            <th>المحصّل</th>
            <th>المصروف منه</th>
            <th>عجز</th>
            <th>زيادة</th>
            <th>الصافي للخزينة</th>
          </tr>
        </thead>
        <tbody>
          {f.collectors.map((c) => (
            <tr key={c.name} data-pdf-break>
              <td className="text-start">{c.name}</td>
              <td>{int(c.count)}</td>
              <td>{money(c.collected)}</td>
              <td>{money(c.paidOut)}</td>
              <td>{money(c.shortage)}</td>
              <td>{money(c.surplus)}</td>
              <td>{money(c.net)}</td>
            </tr>
          ))}
          {!f.collectors.length && (
            <tr data-pdf-break>
              <td colSpan={7}>لا توجد تحصيلات.</td>
            </tr>
          )}
        </tbody>
      </table>

      <table className="doc-table" style={{ marginTop: 14 }}>
        <thead>
          <tr data-pdf-break>
            <th>رقم المستند</th>
            <th>البيان</th>
            <th>النوع</th>
            <th>بواسطة</th>
            <th>وارد</th>
            <th>منصرف</th>
          </tr>
        </thead>
        <tbody>
          {report.entries.map((e) => (
            <tr key={e.id} data-pdf-break>
              <td>{e.ref}</td>
              <td className="text-start">{e.description}</td>
              <td>{e.type}</td>
              <td>{e.by}</td>
              <td>{e.in ? money(e.in) : ""}</td>
              <td>{e.out ? money(e.out) : ""}</td>
            </tr>
          ))}
          <tr className="doc-total" data-pdf-break>
            <td colSpan={4} className="text-start">
              الإجمالي ({int(report.entries.length)} حركة)
            </td>
            <td>{money(f.totalIn)}</td>
            <td>{money(f.totalOut)}</td>
          </tr>
        </tbody>
      </table>

      <SignatureBlock roles={["أمين الخزينة", "المحاسب", "المدير المالي"]} />
    </OfficialDocument>
  );
}

function DocLines({ title, lines, total }: { title: string; lines: DayClosingLine[]; total: number }) {
  return (
    <table className="doc-table" style={{ marginTop: 14 }}>
      <thead>
        <tr data-pdf-break>
          <th>{title}</th>
          <th>العدد</th>
          <th>المبلغ</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} data-pdf-break>
            <td className="text-start">{l.label}</td>
            <td>{int(l.count)}</td>
            <td>{money(l.amount)}</td>
          </tr>
        ))}
        <tr className="doc-total" data-pdf-break>
          <td colSpan={2} className="text-start">
            الإجمالي
          </td>
          <td>{money(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
