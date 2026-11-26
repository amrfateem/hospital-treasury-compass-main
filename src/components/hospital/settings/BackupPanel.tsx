import {
  AlertTriangle,
  CheckCircle2,
  FolderPlus,
  HardDrive,
  HardDriveDownload,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Usb,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acknowledgeRecovery, backupNow, getBackupInfo, setBackupFolders } from "@/lib/hospital/backup.functions";
import { BACKUP_CHANGED } from "@/lib/hospital/backup-events";
import { cn } from "@/lib/utils";

type Info = Awaited<ReturnType<typeof getBackupInfo>>;
type Dest = Info["destinations"][number];

const KIND_LABEL: Record<Dest["kind"], string> = {
  usb: "على الفلاشة (مع البرنامج)",
  host: "على هارد جهاز السيرفر",
  extra: "مكان إضافي",
};
const KIND_ICON = { usb: Usb, host: Monitor, extra: HardDrive } as const;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar-EG") : "لم تُنشأ بعد");
const gb = (b: number | null) => (b === null ? "—" : `${(b / 1024 ** 3).toFixed(1)} جيجا فاضية`);
/** Older than a day and two hours = the daily backup was missed. */
const stale = (iso: string | null) => !iso || Date.now() - Date.parse(iso) > 26 * 3600 * 1000;

export function BackupPanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const load = () => {
    setBusy(true);
    void getBackupInfo()
      .then((i) => {
        setInfo(i);
        setExtra(i.extraDirs);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر قراءة حالة النسخ."))
      .finally(() => setBusy(false));
  };

  useEffect(load, []);

  const run = () => {
    setBusy(true);
    void backupNow()
      .then((r) => {
        if (r.failed.length) toast.warning(`اتحفظت في ${r.saved} مكان، وفشلت في ${r.failed.length} — شوف التفاصيل.`);
        else toast.success(`تم النسخ الاحتياطي في ${r.saved} مكان.`);
        window.dispatchEvent(new Event(BACKUP_CHANGED));
        load();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر النسخ الاحتياطي."))
      .finally(() => setBusy(false));
  };

  const acknowledge = () => {
    setBusy(true);
    void acknowledgeRecovery()
      .then(() => {
        toast.success("تمام — رسالة الاسترجاع مش هتظهر تاني.");
        window.dispatchEvent(new Event(BACKUP_CHANGED));
        load();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر الحفظ."))
      .finally(() => setBusy(false));
  };

  const saveFolders = (next: string[]) => {
    setBusy(true);
    void setBackupFolders({ data: { extraDirs: next } })
      .then((r) => {
        setExtra(r.extraDirs);
        setDraft("");
        toast.success("تم حفظ أماكن النسخ — النسخة الجاية هتتحفظ فيها كمان.");
        load();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر حفظ المكان."))
      .finally(() => setBusy(false));
  };

  const recovery = info?.recoveries[0];

  return (
    <div className="space-y-4">
      <div className="ledger-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <HardDriveDownload className="size-5 text-primary" /> النسخ الاحتياطي
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              نسخة كاملة من البيانات والملفات كل ساعة فيها تغيير، وعلى الأقل مرة كل يوم، في كل الأماكن تحت. كل نسخة
              بتتفحص قبل ما تتحفظ.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} تحديث
            </Button>
            <Button size="sm" onClick={run} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <HardDriveDownload />} نسخ الآن
            </Button>
          </div>
        </div>

        {info && !info.appMode && (
          <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            ده وضع تجربة — النسخ التلقائي بيشتغل على جهاز المستشفى بعد تشغيل البرنامج.
          </p>
        )}

        {recovery && (
          <div
            className={cn(
              "mt-4 flex gap-2 rounded-lg border p-3 text-sm",
              recovery.reason === "damaged-no-backup" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-copper/40 bg-copper/10",
            )}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">
                {recovery.reason === "missing"
                  ? "البيانات ما كانتش موجودة على الفلاشة — النظام رجّعها تلقائيًا من آخر نسخة سليمة."
                  : recovery.reason === "damaged"
                    ? "ملف البيانات كان تالف — النظام حطه على جنب ورجّع آخر نسخة سليمة تلقائيًا."
                    : "ملف البيانات فيه مشكلة ومفيش نسخة سليمة يرجع لها — كلّم الدعم فورًا ولا تمسح أي حاجة."}
              </p>
              <p className="mt-1 text-xs">
                {when(recovery.at)}
                {recovery.restoredFrom && (
                  <>
                    {" "}— من: <span dir="ltr">{recovery.restoredFrom}</span>
                  </>
                )}
              </p>
              <p className="mt-1 text-xs">راجع آخر الإيصالات والحركات اللي اتعملت بعد وقت النسخة دي.</p>
              {recovery.acknowledgedAt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  اتراجعت {when(recovery.acknowledgedAt)}
                  {recovery.acknowledgedBy ? ` — ${recovery.acknowledgedBy}` : ""}
                </p>
              ) : (
                <Button size="sm" variant="outline" className="mt-2" onClick={acknowledge} disabled={busy}>
                  <CheckCircle2 /> تمام، راجعت
                </Button>
              )}
            </div>
          </div>
        )}

        {info && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {info.destinations.map((d) => {
              const Icon = KIND_ICON[d.kind];
              const bad = !!d.lastError || (info.appMode && stale(d.lastAt));
              return (
                <div key={d.dir} className={cn("rounded-lg border p-3", bad && "border-destructive/40 bg-destructive/5")}>
                  <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Icon className="size-4" /> {KIND_LABEL[d.kind]}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                    {bad ? <AlertTriangle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-income" />}
                    {when(d.lastAt)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {d.snapshots} نسخة محفوظة • {gb(d.freeBytes)}
                  </p>
                  <p className="mt-1 break-all text-[11px] text-muted-foreground" dir="ltr">
                    {d.dir}
                  </p>
                  {d.lastError && <p className="mt-2 text-xs text-destructive">آخر محاولة فشلت: {d.lastError}</p>}
                </div>
              );
            })}
          </div>
        )}
        {info && (
          <p className="mt-3 text-xs text-muted-foreground">
            إصدار النظام <span dir="ltr">{info.version}</span> • العنوان <span dir="ltr">http://{info.host}</span>
          </p>
        )}
      </div>

      <div className="ledger-card p-5">
        <h3 className="flex items-center gap-2 font-bold">
          <FolderPlus className="size-5 text-primary" /> مكان نسخ إضافي (مُستحسن)
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          ضيف مكان تالت بعيد عن الفلاشة وجهاز السيرفر: فلاشة تانية أو هارد خارجي، أو فولدر مشترك على جهاز تاني في
          الشبكة، أو فولدر Google Drive / OneDrive على الجهاز. كده لو الفلاشة والجهاز الاتنين حصلهم حاجة، البيانات موجودة.
        </p>
        <ul className="mt-3 space-y-2">
          {extra.map((d) => (
            <li key={d} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <HardDrive className="size-4 text-muted-foreground" />
              <span className="flex-1 break-all" dir="ltr">
                {d}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`إزالة ${d}`}
                disabled={busy}
                onClick={() => saveFolders(extra.filter((x) => x !== d))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) saveFolders([...extra, draft.trim()]);
          }}
        >
          <Input
            dir="ltr"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="E:\AlRahmaBackup  أو  \\RECEPTION-PC\Backup"
            aria-label="مسار مكان النسخ الإضافي"
          />
          <Button type="submit" disabled={busy || !draft.trim() || extra.length >= 5}>
            <FolderPlus /> إضافة
          </Button>
        </form>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" /> لو حصل…
        </p>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          <li>
            <b className="text-foreground">الكهرباء قطعت:</b> كل عملية بتتكتب على الهارد قبل ما تظهر «تم الحفظ»، فاللي اتحفظ مش
            بيضيع. واللي كان لسه بيتبعت من أي جهاز بيفضل محفوظ عليه ويتبعت لوحده لما الكهرباء ترجع.
          </li>
          <li>
            <b className="text-foreground">الفلاشة باظت:</b> انسخ البرنامج على فلاشة جديدة وشغّله — هيلاقي آخر نسخة على هارد
            الجهاز (أو المكان الإضافي) ويرجّعها تلقائيًا.
          </li>
          <li>
            <b className="text-foreground">الويندوز باظ أو الجهاز اتغيّر:</b> البيانات على الفلاشة نفسها — ركّبها في أي جهاز
            وشغّل البرنامج. ولو الملف اتلف، النظام يرجع لآخر نسخة سليمة لوحده.
          </li>
          <li>
            <b className="text-foreground">عاوز ترجع نسخة بإيدك:</b> من جهاز السيرفر شغّل tools\restore-backup.cmd.
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          نصيحة: ركّب UPS للسيرفر والراوتر، وما تفصلش الفلاشة والبرنامج شغال. النسخ: كل نسخ آخر يومين، وبعدها نسخة لكل يوم لمدة
          60 يوم.
        </p>
      </div>
    </div>
  );
}
