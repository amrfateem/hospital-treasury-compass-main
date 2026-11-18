import { Printer, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ReceiptPrinterPrefs } from "@/lib/hospital/receipt-printer";
import { isNativePrint, listPrinters, openExportsFolder } from "@/lib/hospital/native-print";
import { cn } from "@/lib/utils";

function Choice<T extends number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
            value === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function ReceiptPrinterMenu({
  prefs,
  onChange,
  onTest,
}: {
  prefs: ReceiptPrinterPrefs;
  onChange: (p: Partial<ReceiptPrinterPrefs>) => void;
  onTest: () => void;
}) {
  const native = isNativePrint();
  const [printers, setPrinters] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!native) return;
    setLoading(true);
    setError("");
    try {
      const list = await listPrinters();
      setPrinters(list);
      if (!list.length) setError("ويندوز لم يُرجع أي طابعة مثبتة.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر قراءة الطابعات.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Printer /> طابعة الإيصالات
        </Button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] space-y-4">
        <div>
          <p className="font-bold">طابعة الإيصالات (حرارية)</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {native
              ? "الطباعة المباشرة تتجاوز نافذة الطباعة وتطبع بعرض الورق الصحيح. الإعداد خاص بهذا الجهاز."
              : "الطباعة المباشرة تحتاج تحديث برنامج العميل. حاليًا ستُفتح نافذة الطباعة بعرض ورق صحيح."}
          </p>
        </div>

        {native && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">الطابعة</Label>
              <button
                type="button"
                onClick={() => void refresh()}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary"
                disabled={loading}
              >
                <RefreshCw className={cn("size-3", loading && "animate-spin")} /> تحديث
              </button>
            </div>
            <Select value={prefs.printer} onValueChange={(printer) => onChange({ printer })}>
              <SelectTrigger aria-label="الطابعة">
                <SelectValue placeholder="اختر الطابعة" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {printers.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">عرض ورق الطابعة</Label>
          <Choice
            label="عرض ورق الطابعة"
            value={prefs.width}
            onChange={(width) => onChange({ width })}
            options={[
              [80, "٨٠ مم"],
              [58, "٥٨ مم"],
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">عدد النسخ</Label>
          <Choice
            label="عدد النسخ"
            value={prefs.copies}
            onChange={(copies) => onChange({ copies })}
            options={[
              [1, "نسخة"],
              [2, "نسختان"],
              [3, "٣ نسخ"],
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <Label htmlFor="auto-print" className="text-sm leading-snug">
            طباعة الإيصال تلقائيًا بعد الحفظ
          </Label>
          <Switch
            id="auto-print"
            checked={prefs.autoPrint}
            onCheckedChange={(autoPrint) => onChange({ autoPrint })}
          />
        </div>
        {native && (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="silent-print" className="text-sm leading-snug">
                طباعة صامتة بدون نافذة
              </Label>
              <p className="text-[11px] text-muted-foreground">تطبع مباشرة على الطابعة المختارة.</p>
            </div>
            <Switch
              id="silent-print"
              checked={prefs.silent}
              onCheckedChange={(silent) => onChange({ silent })}
            />
          </div>
        )}
        <div className="grid gap-2">
          <Button variant="secondary" className="w-full" onClick={onTest}>
            <Printer /> طباعة تجريبية
          </Button>
          {native && (
            <Button variant="ghost" className="w-full text-xs" onClick={() => void openExportsFolder()}>
              فتح مجلد التصدير
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
