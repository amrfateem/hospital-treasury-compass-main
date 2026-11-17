import { Download, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";
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
import { int, isoDate } from "@/lib/hospital/format";
import { RestorePoints } from "./RestorePoints";
import {
  exportBackup,
  resetSystem,
  restoreBackup,
  useHospitalDB,
  useHospitalSession,
  type ResetMode,
} from "@/lib/hospital/store";

const CONFIRM_WORD = "تصفير";

export function ResetPanel() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const owner = me?.role === "admin";
  const [mode, setMode] = useState<ResetMode | null>(null);
  const [typed, setTyped] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const counts: [string, number][] = [
    ["موظف", db.employees.length],
    ["قيد خزينة", db.transactions.length],
    ["فاتورة مريض", db.patientInvoices.length],
    ["فاتورة مورد", db.supplierInvoices.length],
    ["أصل", db.assets.length],
  ];

  function download() {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `نسخة-احتياطية-المستشفى-${isoDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("تم تنزيل النسخة الاحتياطية.");
  }

  async function upload(file: File) {
    try {
      if (restoreBackup(await file.text())) toast.success("تمت استعادة النسخة الاحتياطية.");
    } catch {
      toast.error("الملف ليس نسخة احتياطية صحيحة لهذا النظام.");
    }
  }

  return (
    <div className="space-y-4">
      <section className="ledger-card p-5">
        <h2 className="text-xl font-bold">النسخ الاحتياطي</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          البيانات محفوظة على سيرفر المستشفى وتظهر لحظيًا على كل الأجهزة. نزّل نسخة احتياطية دورية وقبل أي تصفير.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={download}>
            <Download /> تنزيل نسخة احتياطية
          </Button>
          {owner && (
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload /> استعادة من ملف
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && window.confirm("سيتم استبدال كل البيانات الحالية بمحتوى الملف. متابعة؟"))
                void upload(f);
              e.target.value = "";
            }}
          />
        </div>
        {!owner && (
          <p className="mt-3 text-xs text-muted-foreground">
            الاستعادة والتصفير متاحان للمالك / مدير النظام فقط.
          </p>
        )}
      </section>

      {owner && <RestorePoints />}

      {owner && (
      <section className="ledger-card border-destructive/40 p-5">
        <h2 className="text-xl font-bold text-destructive">تصفير النظام</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          البيانات الحالية: {counts.map(([label, n]) => `${int(n)} ${label}`).join(" • ")}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="font-semibold">تصفير البيانات فقط</p>
            <p className="mt-1 text-xs text-muted-foreground">
              يحذف الموظفين والخزينة والفواتير والأصول وترحيلات الرواتب. يحتفظ بالأقسام والبنود
              وبيانات المستشفى ونسب الضرائب.
            </p>
            <Button
              variant="outline"
              className="mt-3 text-destructive"
              onClick={() => setMode("data")}
            >
              <RotateCcw /> تصفير البيانات
            </Button>
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-semibold">تصفير كامل (ضبط المصنع)</p>
            <p className="mt-1 text-xs text-muted-foreground">
              يحذف كل شيء ويعيد الأقسام والبنود والإعدادات إلى الوضع الافتراضي.
            </p>
            <Button variant="destructive" className="mt-3" onClick={() => setMode("everything")}>
              <RotateCcw /> تصفير كامل
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          التصفير يُطبَّق على كل أجهزة المستشفى في نفس اللحظة.
        </p>
      </section>
      )}

      <AlertDialog
        open={!!mode}
        onOpenChange={(o) => {
          if (!o) {
            setMode(null);
            setTyped("");
          }
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>
              {mode === "everything" ? "تصفير كامل للنظام؟" : "تصفير كل البيانات؟"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              لا يمكن التراجع عن هذه الخطوة. يُنصح بتنزيل نسخة احتياطية أولًا.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="reset-word">
              للتأكيد اكتب كلمة <span className="font-bold text-destructive">{CONFIRM_WORD}</span>
            </Label>
            <Input
              id="reset-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              disabled={typed.trim() !== CONFIRM_WORD}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (mode && resetSystem(mode))
                  toast.success(
                    mode === "everything" ? "تم تصفير النظام بالكامل." : "تم تصفير البيانات.",
                  );
                setMode(null);
                setTyped("");
              }}
            >
              تأكيد التصفير
            </AlertDialogAction>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
