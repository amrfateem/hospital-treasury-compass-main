import { Link } from "@tanstack/react-router";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { int } from "@/lib/hospital/format";
import {
  deleteListItem,
  newId,
  saveListItem,
  useHospitalDB,
  type ListItem,
  type PayerItem,
  type SimpleListKey,
} from "@/lib/hospital/store";

const SIMPLE_LISTS: { key: SimpleListKey; title: string; hint: string; placeholder: string }[] = [
  {
    key: "expenseCategories",
    title: "أنواع المشتريات والمصروفات",
    hint: "تظهر في فواتير الموردين.",
    placeholder: "مثال: غازات طبية",
  },
  {
    key: "assetCategories",
    title: "تصنيفات الأصول والأجهزة",
    hint: "اقتراحات عند إضافة أصل في الجرد.",
    placeholder: "مثال: أجهزة أسنان",
  },
  {
    key: "jobTitles",
    title: "المسميات الوظيفية",
    hint: "اقتراحات عند إضافة موظف.",
    placeholder: "مثال: أخصائي علاج طبيعي",
  },
  {
    key: "paymentMethods",
    title: "طرق الدفع",
    hint: "تظهر في الفواتير وتقفيل الورديات (نقدي، فيزا، إنستاباي...).",
    placeholder: "مثال: فودافون كاش",
  },
  {
    key: "stockCategories",
    title: "تصنيفات المخزن",
    hint: "تصنيف أصناف الأدوية والمستلزمات والكيماويات.",
    placeholder: "مثال: محاليل وريدية",
  },
  {
    key: "pettyCategories",
    title: "بنود النثريات",
    hint: "بنود المصروفات الصغيرة التي تُصرف من خزينة النثريات.",
    placeholder: "مثال: مياه شرب",
  },
];

/** Inputs keep their own text and save on blur / Enter so typing stays smooth. */
function useDraft(value: string) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return [v, setV] as const;
}

function NameCell({ item, onSave }: { item: ListItem; onSave: (name: string) => void }) {
  const [v, setV] = useDraft(item.name);
  const commit = () => {
    const n = v.trim();
    if (!n) {
      setV(item.name);
    } else if (n !== item.name) {
      onSave(n);
      toast.success("تم الحفظ.");
    }
  };
  return (
    <Input
      value={v}
      aria-label="اسم البند"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) =>
        e.key === "Enter" && (e.preventDefault(), (e.target as HTMLInputElement).blur())
      }
      className="h-8 border-transparent bg-transparent px-2 shadow-none hover:border-input focus-visible:border-input focus-visible:bg-card"
    />
  );
}

function SimpleList({
  listKey,
  title,
  hint,
  placeholder,
}: (typeof SIMPLE_LISTS)[number] & { listKey: SimpleListKey }) {
  const { lists } = useHospitalDB();
  const items = lists[listKey];
  const [name, setName] = useState("");
  function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (items.some((i) => i.name === n)) {
      toast.error("هذا البند موجود بالفعل.");
      return;
    }
    saveListItem(listKey, { id: newId(), name: n });
    setName("");
  }
  return (
    <section className="ledger-card flex flex-col overflow-hidden">
      <div className="border-b bg-secondary/60 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-secondary-foreground">{title}</h3>
          <span className="num text-xs text-muted-foreground">{int(items.length)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <ul className="max-h-72 flex-1 divide-y overflow-y-auto">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-1 px-2 py-1">
            <NameCell item={it} onSave={(n) => saveListItem(listKey, { ...it, name: n })} />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`حذف ${it.name}`}
              disabled={listKey === "paymentMethods" && items.length === 1}
              onClick={() => {
                if (window.confirm(`حذف "${it.name}" من القائمة؟ السجلات القديمة لن تتأثر.`))
                  deleteListItem(listKey, it.id);
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {!items.length && (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">القائمة فارغة.</li>
        )}
      </ul>
      <form onSubmit={add} className="flex gap-2 border-t p-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          className="h-9"
          aria-label={`إضافة إلى ${title}`}
        />
        <Button type="submit" size="sm" className="h-9 shrink-0">
          <Plus /> إضافة
        </Button>
      </form>
    </section>
  );
}

function ServicesLink() {
  const { lists } = useHospitalDB();
  return (
    <section className="ledger-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-base font-bold">خدمات الأقسام وأسعارها</h3>
        <p className="text-xs text-muted-foreground">
          {int(lists.services.length)} خدمة — الإضافة والتعديل لكل قسم من صفحة الخدمات.
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link to="/services">
          <ListChecks /> فتح قائمة الخدمات
        </Link>
      </Button>
    </section>
  );
}

function PayerRow({ p }: { p: PayerItem }) {
  const [pct, setPct] = useDraft(String(p.percent));
  return (
    <li className="flex items-center gap-1 px-2 py-1">
      <NameCell item={p} onSave={(n) => saveListItem("payers", { ...p, name: n })} />
      <div className="flex shrink-0 items-center gap-1">
        <Input
          type="number"
          min="0"
          max="100"
          aria-label={`نسبة تغطية ${p.name}`}
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          onBlur={() => {
            const v = Number(pct);
            if (!(v >= 0 && v <= 100)) setPct(String(p.percent));
            else if (v !== p.percent) {
              saveListItem("payers", { ...p, percent: v });
              toast.success(`نسبة ${p.name} أصبحت ${v}٪`);
            }
          }}
          className="h-8 w-20"
        />
        <span className="text-xs text-muted-foreground">٪</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`حذف ${p.name}`}
        onClick={() =>
          window.confirm(`حذف "${p.name}"؟ الفواتير القديمة لن تتأثر.`) &&
          deleteListItem("payers", p.id)
        }
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function PayersList() {
  const { lists } = useHospitalDB();
  const [name, setName] = useState("");
  const [pct, setPct] = useState("80");
  function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const v = Number(pct);
    if (!n) return;
    if (!(v >= 0 && v <= 100)) return void toast.error("النسبة من ٠ إلى ١٠٠.");
    saveListItem("payers", { id: newId(), name: n, percent: v });
    setName("");
    toast.success(`تمت إضافة ${n}.`);
  }
  return (
    <section className="ledger-card flex flex-col overflow-hidden">
      <div className="border-b bg-secondary/60 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-secondary-foreground">
            جهات التأمين والنقابات والتعاقدات
          </h3>
          <span className="num text-xs text-muted-foreground">{int(lists.payers.length)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          النسبة = ما تتحمله الجهة من صافي الفاتورة (قابلة للتعديل داخل كل فاتورة). الباقي يدفعه
          المريض نقدًا.
        </p>
      </div>
      <ul className="max-h-72 flex-1 divide-y overflow-y-auto">
        {lists.payers.map((p) => (
          <PayerRow key={p.id} p={p} />
        ))}
        {!lists.payers.length && (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            لا توجد جهات بعد. مثال: نقابة المهندسين ٨٠٪
          </li>
        )}
      </ul>
      <form onSubmit={add} className="flex gap-2 border-t p-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم الجهة — مثال: نقابة الأطباء"
          className="h-9"
          aria-label="اسم جهة التأمين"
        />
        <Input
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          type="number"
          min="0"
          max="100"
          className="h-9 w-20"
          aria-label="نسبة التغطية"
        />
        <Button type="submit" size="sm" className="h-9 shrink-0">
          <Plus /> إضافة
        </Button>
      </form>
    </section>
  );
}

export function ListsManager() {
  return (
    <div className="space-y-4">
      <ServicesLink />
      <PayersList />
      <div className="grid gap-4 md:grid-cols-2">
        {SIMPLE_LISTS.map((l) => (
          <SimpleList {...l} key={l.key} listKey={l.key} />
        ))}
      </div>
    </div>
  );
}
