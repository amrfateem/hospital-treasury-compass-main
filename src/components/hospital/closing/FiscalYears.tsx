import { Archive, Eye, Lock, LockOpen, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FieldRow } from "@/components/hospital/kit";
import { findDepartment } from "@/lib/hospital/constants";
import { closeBlocker, pendingInYear, yearSummary, yearsList, type YearState } from "@/lib/hospital/fiscal";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import { closeFiscalYear, flushPending, reopenFiscalYear, useCan, useHospitalDB, useHospitalSession } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<YearState, string> = {
  open: "مفتوحة — السنة الحالية",
  ended: "انتهت — بانتظار الإقفال",
  closed: "مقفولة ومؤرشفة",
};

/** Archive of fiscal years (1/1 – 31/12): close a finished year, view its frozen results, reopen (director). */
export function FiscalYears({ onShowYear }: { onShowYear: (year: number) => void }) {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canClose = useCan("closing", "edit") && (me?.role === "admin" || me?.role === "finance");
  const isDirector = me?.role === "admin";
  const today = isoDate(new Date());
  const years = yearsList(db, today);
  const [closing, setClosing] = useState<number | null>(null);
  const [reopening, setReopening] = useState<number | null>(null);
  const waiting = years.filter((y) => y.state === "ended");
  const lastClosed = years.find((y) => y.state === "closed")?.year;

  return (
    <section className="ledger-card mb-6 p-4" aria-labelledby="fy-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="fy-title" className="flex items-center gap-2 text-lg font-bold">
            <Archive className="size-5 text-primary" /> أرشيف السنوات المالية
          </h2>
          <p className="text-xs text-muted-foreground">
            السنة المالية من ١ يناير حتى ٣١ ديسمبر. بعد انتهائها تُقفل وتُؤرشف: تُحفظ نتيجتها، ولا يمكن تعديل أي حركة بتاريخ فيها،
            وتُرحَّل الأرصدة (الخزائن، المرضى، الموردين، المخزن) تلقائيًا للسنة الجديدة.
          </p>
        </div>
      </div>
      {waiting.length > 0 && (
        <p className="mb-3 flex items-center gap-2 rounded-md border border-dashed border-copper/60 bg-copper/5 px-3 py-2 text-sm">
          <ShieldAlert className="size-4 shrink-0 text-copper" />
          {waiting.length === 1 ? `سنة ${waiting[0]!.year} انتهت ولم تُقفل بعد.` : `سنوات ${waiting.map((w) => w.year).join("، ")} انتهت ولم تُقفل بعد.`}{" "}
          {canClose ? "اقفلها لتثبيت حساباتها." : "يقفلها المدير المالي."}
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {years.map(({ year, state, record }) => {
          const s = record?.status === "closed" ? record.summary : yearSummary(db, year);
          const profit = s.net >= 0;
          return (
            <li key={year} className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-xl font-bold num">{year}</p>
                <span className={cn("year-state", `year-state-${state}`)}>
                  {state === "closed" ? <Lock className="size-3" /> : null}
                  {STATE_LABEL[state]}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                من ١/١/{year} إلى ٣١/١٢/{year}
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-xs">
                <div>
                  <dt className="text-muted-foreground">الإيرادات</dt>
                  <dd className="num font-semibold text-income">{money(s.totalIn)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">المصروفات</dt>
                  <dd className="num font-semibold text-expense">{money(s.totalOut)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{profit ? "صافي الربح" : "صافي الخسارة"}</dt>
                  <dd className={cn("num font-bold", profit ? "text-income" : "text-expense")}>{money(Math.abs(s.net))}</dd>
                </div>
              </dl>
              {record?.status === "closed" && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  أقفلها {record.closedBy} في {dateLabel(isoDate(new Date(record.closedAt)))} • {int(s.receipts)} إيصال • {int(s.entries)} حركة
                </p>
              )}
              {record?.status === "reopened" && (
                <p className="mt-2 text-[11px] text-expense">
                  أعاد فتحها {record.reopenedBy} — السبب: {record.reopenReason}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onShowYear(year)}>
                  <Eye /> التقفيل السنوي
                </Button>
                {state === "ended" && canClose && (
                  <Button size="sm" onClick={() => setClosing(year)}>
                    <Lock /> إقفال وأرشفة السنة
                  </Button>
                )}
                {state === "closed" && isDirector && year === lastClosed && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setReopening(year)}>
                    <LockOpen /> إعادة فتح
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <CloseDialog year={closing} onClose={() => setClosing(null)} />
      <ReopenDialog year={reopening} onClose={() => setReopening(null)} />
    </section>
  );
}

function CloseDialog({ year, onClose }: { year: number | null; onClose: () => void }) {
  const db = useHospitalDB();
  const [busy, setBusy] = useState(false);
  if (year === null) return <Dialog open={false} />;
  const today = isoDate(new Date());
  const s = yearSummary(db, year);
  const blocker = closeBlocker(db, year, today);
  const waiting = pendingInYear(db, year);
  async function confirm() {
    if (year === null) return;
    setBusy(true);
    if (closeFiscalYear(year)) {
      await flushPending();
      toast.success(`تم إقفال وأرشفة سنة ${year}. السنة الجديدة مفتوحة بأرصدتها.`);
      onClose();
    }
    setBusy(false);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>إقفال وأرشفة السنة المالية {year}</DialogTitle>
          <DialogDescription>
            بعد الإقفال تُحفظ نتيجة السنة كما هي، ولا يستطيع أي حد إضافة أو تعديل أو حذف إيصال أو مصروف أو قيد بتاريخ من ١/١/{year} حتى
            ٣١/١٢/{year}. الأرصدة تُرحَّل تلقائيًا لسنة {year + 1}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">الإيرادات</p>
              <p className="num font-bold text-income">{money(s.totalIn)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">المصروفات</p>
              <p className="num font-bold text-expense">{money(s.totalOut)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.net >= 0 ? "صافي الربح" : "صافي الخسارة"}</p>
              <p className={cn("num font-bold", s.net >= 0 ? "text-income" : "text-expense")}>{money(Math.abs(s.net))}</p>
            </div>
          </div>
          {s.byDept.length > 0 && (
            <ul className="divide-y rounded-md border text-xs">
              {s.byDept.map((d) => (
                <li key={d.dept} className="flex justify-between px-3 py-1.5">
                  <span>{findDepartment(db.departments, d.dept).name}</span>
                  <span className={cn("num", d.net < 0 && "text-expense")}>{money(d.net)}</span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold">الأرصدة المرحَّلة لسنة {year + 1} (يوم ٣١/١٢/{year})</p>
            <ul className="divide-y rounded-md border text-xs">
              {s.boxes.map((b) => (
                <li key={b.boxId} className="flex justify-between px-3 py-1.5">
                  <span>{b.name}</span>
                  <span className="num">{money(b.balance)}</span>
                </li>
              ))}
            </ul>
          </div>
          {waiting > 0 && !blocker && (
            <p className="rounded-md bg-copper/10 px-3 py-2 text-xs">
              يوجد {int(waiting)} طلب بانتظار الاعتماد من سنة {year}. يمكن الإقفال، وأي طلب يُعتمد بعد كده يُسجَّل في السنة الجديدة.
            </p>
          )}
          {blocker && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{blocker}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => void confirm()} disabled={busy || !!blocker}>
            <Lock /> تأكيد الإقفال والأرشفة
          </Button>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ year, onClose }: { year: number | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  if (year === null) return <Dialog open={false} />;
  async function confirm() {
    if (year === null) return;
    if (reopenFiscalYear(year, reason)) {
      await flushPending();
      toast.success(`أُعيد فتح سنة ${year} — اقفلها مرة أخرى بعد التصحيح.`);
      setReason("");
      onClose();
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>إعادة فتح سنة {year}</DialogTitle>
          <DialogDescription>
            إعادة الفتح تسمح بتعديل حركات السنة مرة أخرى، وتُسجَّل باسمك في سجل العمليات. استخدمها للتصحيح فقط ثم اقفل السنة من جديد.
          </DialogDescription>
        </DialogHeader>
        <FieldRow label="سبب إعادة الفتح" htmlFor="fy-reason">
          <Textarea id="fy-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تسجيل فاتورة مورد عن ديسمبر وصلت متأخرة" />
        </FieldRow>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button variant="destructive" onClick={() => void confirm()}>
            <LockOpen /> إعادة فتح السنة
          </Button>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
