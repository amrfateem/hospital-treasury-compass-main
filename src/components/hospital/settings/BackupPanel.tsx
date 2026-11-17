import { HardDriveDownload, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { backupNow, getBackupInfo } from "@/lib/hospital/backup.functions";

interface Info {
  lastDay: string | null;
  lastAt: string | null;
  usbDir: string;
  hostDir: string | null;
  lastError: string | null;
  version: string;
  host: string;
  dataDir: string;
}

export function BackupPanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    void getBackupInfo()
      .then(setInfo)
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر قراءة حالة النسخ."))
      .finally(() => setBusy(false));
  };

  useEffect(load, []);

  const run = () => {
    setBusy(true);
    void backupNow()
      .then(() => {
        toast.success("تم النسخ الاحتياطي إلى الفلاشة والكمبيوتر.");
        load();
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر النسخ الاحتياطي."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <div className="ledger-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <HardDriveDownload className="size-5 text-primary" /> النسخ الاحتياطي اليومي
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              نسخة كاملة من قاعدة البيانات والملفات تُحفظ تلقائيًا كل يوم على الفلاشة وعلى هذا الكمبيوتر.
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

        {info && (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">آخر نسخة</p>
              <p className="mt-1 font-semibold">{info.lastAt ? new Date(info.lastAt).toLocaleString("ar-EG") : "لم تُنشأ بعد"}</p>
              <p className="mt-1 text-xs text-muted-foreground">اليوم: {info.lastDay ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">إصدار النظام</p>
              <p className="mt-1 font-semibold" dir="ltr">
                {info.version}
              </p>
              <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                http://{info.host}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">نسخة الفلاشة</p>
              <p className="mt-1 break-all text-xs" dir="ltr">
                {info.usbDir}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">نسخة الكمبيوتر</p>
              <p className="mt-1 break-all text-xs" dir="ltr">
                {info.hostDir ?? "غير متاح"}
              </p>
            </div>
          </div>
        )}
        {info?.lastError && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            آخر محاولة فشلت: {info.lastError}
          </p>
        )}
      </div>
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        لا تفصل الفلاشة أثناء العمل. النسخة اليومية تحمي من تلف الفلاشة، ونسخة الكمبيوتر تحمي من فقد الفلاشة.
        الاحتفاظ: 60 نسخة يومية، وملفات المرضى تُنسخ مرة واحدة وتُحدَّث عند تغيّرها.
      </div>
    </div>
  );
}
