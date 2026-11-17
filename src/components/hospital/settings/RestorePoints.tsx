import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateLabel, int } from "@/lib/hospital/format";
import { listRestoreDays, restoreToDay } from "@/lib/hospital/restore.functions";
import { loadHospital, unsentCount } from "@/lib/hospital/store";

const WORD = "استعادة";

/** Director-only: return the whole system to how it was at the start of an earlier day. */
export function RestorePoints() {
  const qc = useQueryClient();
  const days = useQuery({ queryKey: ["restore-days"], queryFn: () => listRestoreDays() });
  const [day, setDay] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function restore() {
    if (!day) return;
    if (unsentCount() > 0) {
      toast.error("انتظر حتى تصل كل التغييرات على هذا الجهاز للسيرفر ثم أعد المحاولة.");
      return;
    }
    setBusy(true);
    try {
      await restoreToDay({ data: { day } });
      await loadHospital();
      await qc.invalidateQueries({ queryKey: ["restore-days"] });
      toast.success(`تمت استعادة النظام إلى بداية يوم ${dateLabel(day)}.`);
      setDay(null);
      setTyped("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّرت الاستعادة.");
    } finally {
      setBusy(false);
    }
  }

  const list = days.data ?? [];
  return (
    <section className="ledger-card p-5">
      <div className="flex items-start gap-3">
        <div className="stat-icon shrink-0 text-primary">
          <History className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold">نقاط الاستعادة اليومية</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            النظام يحفظ تلقائيًا نسخة من بداية كل يوم فيه تغييرات (لمدة سنة). الاستعادة ترجع النظام كما كان في
            بداية اليوم المختار، مع الاحتفاظ بسجل العمليات كاملًا.
          </p>
        </div>
      </div>
      <div className="mt-4">
        {days.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> جارٍ التحميل...
          </p>
        )}
        {days.isError && <p className="text-sm text-destructive">تعذّر تحميل نقاط الاستعادة.</p>}
        {!days.isLoading && !list.length && !days.isError && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            لا توجد نقاط استعادة بعد — تظهر أول نقطة بعد أول تعديل في يوم جديد.
          </p>
        )}
        {!!list.length && (
          <ul className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {list.map((d) => (
              <li key={d.day} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">بداية يوم {dateLabel(d.day)}</p>
                  <p className="num text-[11px] text-muted-foreground">{int(d.pieces)} جزء محفوظ</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setDay(d.day)}>
                  <RotateCcw /> استعادة
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={!!day}
        onOpenChange={(o) => {
          if (!o && !busy) {
            setDay(null);
            setTyped("");
          }
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>استعادة النظام إلى بداية يوم {day ? dateLabel(day) : ""}؟</AlertDialogTitle>
            <AlertDialogDescription>
              كل ما سُجّل بعد بداية هذا اليوم على كل الأجهزة سيُلغى. يُنصح بتنزيل نسخة احتياطية أولًا.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="restore-word">
              للتأكيد اكتب كلمة <span className="font-bold text-destructive">{WORD}</span>
            </Label>
            <Input id="restore-word" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              disabled={typed.trim() !== WORD || busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void restore();
              }}
            >
              {busy && <Loader2 className="animate-spin" />} تأكيد الاستعادة
            </AlertDialogAction>
            <AlertDialogCancel disabled={busy}>تراجع</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
