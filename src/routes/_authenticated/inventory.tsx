import { createFileRoute } from "@tanstack/react-router";
import { Boxes, FileDown, Pencil, Plus, TrendingDown, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import {
  DeptSelect,
  EmptyRow,
  FieldRow,
  HeadRow,
  matches,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { OfficialDocument, SignatureBlock } from "@/components/hospital/OfficialDocument";
import { findDepartment, sortDepartments, type DepartmentId } from "@/lib/hospital/constants";
import { dateLabel, int, isoDate, money } from "@/lib/hospital/format";
import { assetValuation } from "@/lib/hospital/finance";
import {
  ASSET_CONDITIONS,
  deleteAsset,
  newId,
  saveAsset,
  useHospitalDB,
  type Asset,
  type AssetCondition,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({
    meta: [
      { title: "جرد الأصول والأجهزة الطبية | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "سجل الأجهزة الطبية والأصول لكل قسم مع التكلفة والإهلاك والقيمة الدفترية وتصدير قائمة الجرد.",
      },
      { property: "og:title", content: "جرد الأصول | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "تقييم أصول المستشفى لكل قسم للملف الضريبي." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const db = useHospitalDB();
  const [asOf, setAsOf] = useState(() => isoDate(new Date()));
  const [dept, setDept] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Asset | null>(null);
  const [open, setOpen] = useState(false);
  const pdf = usePdfExport();

  const valued = useMemo(
    () =>
      db.assets.map((a) => ({
        a,
        ...assetValuation(a.unitCost, a.quantity, a.purchaseDate, a.usefulLifeYears, asOf),
      })),
    [db.assets, asOf],
  );
  const rows = valued.filter(
    (r) =>
      (dept === "all" || r.a.department === dept) &&
      matches(query, r.a.name, r.a.category, r.a.serialNumber),
  );
  const depts = sortDepartments(db.departments);
  const sum = (list: typeof valued) =>
    list.reduce(
      (s, r) => ({
        cost: s.cost + r.cost,
        dep: s.dep + r.depreciation,
        book: s.book + r.bookValue,
      }),
      { cost: 0, dep: 0, book: 0 },
    );
  const t = sum(rows);
  const byDept = depts
    .map((d) => ({
      d,
      count: valued.filter((r) => r.a.department === d.id).length,
      ...sum(valued.filter((r) => r.a.department === d.id)),
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.book - a.book);
  const maxBook = Math.max(1, ...byDept.map((x) => x.book));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="الأجهزة الطبية — الملف الضريبي"
        title="جرد وتقييم الأصول"
        description="القيمة الدفترية = التكلفة − مجمع الإهلاك (قسط ثابت حسب العمر الإنتاجي) حتى تاريخ الجرد."
        actions={
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus /> إضافة أصل
            </Button>
            <Button
              variant="outline"
              disabled={pdf.busy}
              onClick={() => pdf.run(`قائمة-الجرد-${asOf}.pdf`, "تم تصدير قائمة الجرد.")}
            >
              <FileDown /> {pdf.busy ? "جارٍ التصدير..." : "تصدير قائمة الجرد PDF"}
            </Button>
          </>
        }
      />

      <div className="ledger-card mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor="asof" className="whitespace-nowrap text-sm">
            تاريخ الجرد
          </Label>
          <Input
            id="asof"
            type="date"
            value={asOf}
            onChange={(e) => e.target.value && setAsOf(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <DeptSelect value={dept} onChange={setDept} allowAll className="sm:w-60" />
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="بحث باسم الأصل أو الرقم المسلسل"
            className="sm:w-64"
          />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="عدد الأصول"
          value={int(rows.reduce((s, r) => s + r.a.quantity, 0))}
          icon={Boxes}
          hint={`${int(rows.length)} بند`}
        />
        <StatCard label="التكلفة التاريخية" value={money(t.cost)} icon={Wallet} />
        <StatCard label="مجمع الإهلاك" value={money(t.dep)} icon={TrendingDown} tone="expense" />
        <StatCard
          label="القيمة الدفترية"
          value={money(t.book)}
          icon={Wallet}
          tone="primary"
          hint="بالجنيه المصري"
        />
      </div>

      {byDept.length > 0 && (
        <div className="ledger-card mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
          {byDept.map((x) => (
            <button
              key={x.d.id}
              type="button"
              onClick={() => setDept(dept === x.d.id ? "all" : x.d.id)}
              className={cn(
                "rounded-lg p-2 text-right transition-colors hover:bg-muted",
                dept === x.d.id && "bg-muted",
              )}
            >
              <DeptBadge id={x.d.id} />
              <p className="num mt-2 text-lg font-bold">{money(x.book)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", findDepartment(db.departments, x.d.id).dot)}
                  style={{ width: `${(x.book / maxBook) * 100}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      )}

      <TableCard minWidth={1040}>
        <thead>
          <HeadRow>
            <Th>الأصل</Th>
            <Th>القسم</Th>
            <Th>تاريخ الشراء</Th>
            <Th num>الكمية</Th>
            <Th num>تكلفة الوحدة</Th>
            <Th num>إجمالي التكلفة</Th>
            <Th num>مجمع الإهلاك</Th>
            <Th num>القيمة الدفترية</Th>
            <Th>الحالة</Th>
            <Th />
          </HeadRow>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.a.id} className="border-b last:border-0 hover:bg-muted/50">
              <Td>
                <p className="font-semibold">{r.a.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.a.category}
                  {r.a.serialNumber && (
                    <>
                      {" "}
                      • <span dir="ltr">{r.a.serialNumber}</span>
                    </>
                  )}{" "}
                  • عمر {int(r.a.usefulLifeYears)} سنوات
                </p>
              </Td>
              <Td>
                <DeptBadge id={r.a.department} />
              </Td>
              <Td num className="text-right">
                {dateLabel(r.a.purchaseDate)}
              </Td>
              <Td num>{int(r.a.quantity)}</Td>
              <Td num>{money(r.a.unitCost)}</Td>
              <Td num>{money(r.cost)}</Td>
              <Td num className="text-expense">
                {money(r.depreciation)}
              </Td>
              <Td num className="font-bold text-primary">
                {money(r.bookValue)}
              </Td>
              <Td className="text-xs">{ASSET_CONDITIONS[r.a.condition]}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`تعديل ${r.a.name}`}
                    onClick={() => {
                      setEditing(r.a);
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`حذف ${r.a.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (window.confirm(`حذف ${r.a.name} من سجل الأصول؟`)) {
                        deleteAsset(r.a.id);
                        toast.success("تم حذف الأصل.");
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={10} text="لا توجد أصول مسجلة." />}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-copper/40 bg-accent/60 font-bold text-accent-foreground">
              <Td colSpan={5}>الإجمالي</Td>
              <Td num>{money(t.cost)}</Td>
              <Td num>{money(t.dep)}</Td>
              <Td num>{money(t.book)}</Td>
              <Td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </TableCard>

      <AssetDialog
        open={open}
        onOpenChange={setOpen}
        asset={editing}
        defaultDepartment={dept === "all" ? "general" : dept}
      />

      <OfficialDocument
        ref={pdf.ref}
        settings={db.settings}
        orientation="landscape"
        title="قائمة جرد الأصول والأجهزة الطبية"
        subtitle={`في ${dateLabel(asOf)} — ${dept === "all" ? "جميع الأقسام" : `قسم ${findDepartment(db.departments, dept).name}`}`}
        issuedOn={dateLabel(isoDate(new Date()))}
      >
        <table className="doc-table">
          <thead>
            <tr data-pdf-break>
              <th>م</th>
              <th>اسم الأصل</th>
              <th>التصنيف</th>
              <th>الرقم المسلسل</th>
              <th>تاريخ الشراء</th>
              <th>العمر الإنتاجي</th>
              <th>الكمية</th>
              <th>تكلفة الوحدة</th>
              <th>إجمالي التكلفة</th>
              <th>مجمع الإهلاك</th>
              <th>القيمة الدفترية</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {depts
              .filter((d) => dept === "all" || d.id === dept)
              .map((d) => {
                const list = rows.filter((r) => r.a.department === d.id);
                if (!list.length) return null;
                const s = sum(list);
                return [
                  <tr key={`${d.id}-h`} className="doc-group" data-pdf-break>
                    <td colSpan={12}>مركز التكلفة: قسم {d.name}</td>
                  </tr>,
                  ...list.map((r, i) => (
                    <tr key={r.a.id} data-pdf-break>
                      <td>{int(i + 1)}</td>
                      <td className="text-start">{r.a.name}</td>
                      <td>{r.a.category}</td>
                      <td dir="ltr">{r.a.serialNumber || "—"}</td>
                      <td>{dateLabel(r.a.purchaseDate)}</td>
                      <td>{int(r.a.usefulLifeYears)} سنوات</td>
                      <td>{int(r.a.quantity)}</td>
                      <td>{money(r.a.unitCost)}</td>
                      <td>{money(r.cost)}</td>
                      <td>{money(r.depreciation)}</td>
                      <td style={{ fontWeight: 700 }}>{money(r.bookValue)}</td>
                      <td>{ASSET_CONDITIONS[r.a.condition]}</td>
                    </tr>
                  )),
                  <tr key={`${d.id}-s`} className="doc-subtotal" data-pdf-break>
                    <td colSpan={8} className="text-start">
                      إجمالي أصول قسم {d.name}
                    </td>
                    <td>{money(s.cost)}</td>
                    <td>{money(s.dep)}</td>
                    <td>{money(s.book)}</td>
                    <td />
                  </tr>,
                ];
              })}
            <tr className="doc-total" data-pdf-break>
              <td colSpan={8} className="text-start">
                الإجمالي العام
              </td>
              <td>{money(t.cost)}</td>
              <td>{money(t.dep)}</td>
              <td>{money(t.book)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <SignatureBlock roles={["لجنة الجرد", "المحاسب المختص", "مدير المستشفى"]} />
      </OfficialDocument>
    </div>
  );
}

function AssetDialog({
  open,
  onOpenChange,
  asset,
  defaultDepartment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  asset: Asset | null;
  defaultDepartment: DepartmentId;
}) {
  const { lists } = useHospitalDB();
  const blank = {
    name: "",
    category: "",
    serialNumber: "",
    department: defaultDepartment,
    purchaseDate: "",
    unitCost: "",
    quantity: "1",
    usefulLifeYears: "8",
    condition: "good" as AssetCondition,
  };
  const [f, setF] = useState(blank);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setF(
      asset
        ? {
            name: asset.name,
            category: asset.category,
            serialNumber: asset.serialNumber ?? "",
            department: asset.department,
            purchaseDate: asset.purchaseDate,
            unitCost: String(asset.unitCost),
            quantity: String(asset.quantity),
            usefulLifeYears: String(asset.usefulLifeYears),
            condition: asset.condition,
          }
        : { ...blank, purchaseDate: isoDate(new Date()) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset, defaultDepartment]);

  const text = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setError("اكتب اسم الأصل.");
    if (!(Number(f.unitCost) > 0) || !(Number(f.quantity) >= 1) || !(Number(f.usefulLifeYears) > 0))
      return setError("أدخل تكلفة وكمية وعمرًا إنتاجيًا صحيحة.");
    saveAsset({
      id: asset?.id ?? newId(),
      name: f.name.trim(),
      category: f.category.trim() || "أجهزة طبية",
      serialNumber: f.serialNumber.trim() || undefined,
      department: f.department,
      purchaseDate: f.purchaseDate,
      unitCost: Number(f.unitCost),
      quantity: Math.round(Number(f.quantity)),
      usefulLifeYears: Number(f.usefulLifeYears),
      condition: f.condition,
    });
    toast.success(asset ? "تم تحديث الأصل." : "تمت إضافة الأصل.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {asset ? "تعديل أصل" : "إضافة أصل / جهاز طبي"}
          </DialogTitle>
          <DialogDescription>يُحسب الإهلاك بطريقة القسط الثابت من تاريخ الشراء.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="اسم الأصل" htmlFor="as-name" className="sm:col-span-2">
            <Input id="as-name" value={f.name} onChange={text("name")} />
          </FieldRow>
          <FieldRow label="التصنيف" htmlFor="as-cat">
            <Input
              id="as-cat"
              list="asset-cats"
              value={f.category}
              onChange={text("category")}
              placeholder="اختر من القائمة أو اكتب تصنيفًا"
            />
            <datalist id="asset-cats">
              {lists.assetCategories.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </FieldRow>
          <FieldRow label="الرقم المسلسل (اختياري)" htmlFor="as-sn">
            <Input id="as-sn" value={f.serialNumber} onChange={text("serialNumber")} dir="ltr" />
          </FieldRow>
          <FieldRow label="القسم">
            <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
          </FieldRow>
          <FieldRow label="الحالة">
            <Select
              value={f.condition}
              onValueChange={(v) => setF({ ...f, condition: v as AssetCondition })}
            >
              <SelectTrigger aria-label="الحالة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {Object.entries(ASSET_CONDITIONS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="تاريخ الشراء" htmlFor="as-date">
            <Input
              id="as-date"
              type="date"
              value={f.purchaseDate}
              onChange={text("purchaseDate")}
              required
            />
          </FieldRow>
          <FieldRow label="العمر الإنتاجي (سنوات)" htmlFor="as-life">
            <Input
              id="as-life"
              type="number"
              min="1"
              value={f.usefulLifeYears}
              onChange={text("usefulLifeYears")}
            />
          </FieldRow>
          <FieldRow label="تكلفة الوحدة (ج.م)" htmlFor="as-cost">
            <Input
              id="as-cost"
              type="number"
              min="0"
              step="0.01"
              value={f.unitCost}
              onChange={text("unitCost")}
            />
          </FieldRow>
          <FieldRow label="الكمية" htmlFor="as-qty">
            <Input
              id="as-qty"
              type="number"
              min="1"
              value={f.quantity}
              onChange={text("quantity")}
            />
          </FieldRow>
          {error && <p className="text-sm font-medium text-destructive sm:col-span-2">{error}</p>}
          <DialogFooter className="gap-2 sm:col-span-2 sm:justify-start">
            <Button type="submit">{asset ? "حفظ التعديلات" : "إضافة الأصل"}</Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
