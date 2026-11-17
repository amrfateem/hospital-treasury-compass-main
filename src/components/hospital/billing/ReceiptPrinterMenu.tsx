import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { ReceiptPrinterPrefs } from "@/lib/hospital/receipt-printer";
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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Printer /> طابعة الإيصالات
        </Button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="end" className="w-80 space-y-4">
        <div>
          <p className="font-bold">طابعة الإيصالات (حرارية)</p>
          <p className="text-xs text-muted-foreground">
            الإعداد خاص بهذا الجهاز. اختر طابعة الإيصالات في نافذة الطباعة أول مرة.
          </p>
        </div>
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
        <Button variant="secondary" className="w-full" onClick={onTest}>
          <Printer /> طباعة تجريبية
        </Button>
      </PopoverContent>
    </Popover>
  );
}
