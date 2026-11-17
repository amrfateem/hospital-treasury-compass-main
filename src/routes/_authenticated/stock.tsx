import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Building2, CalendarClock, ClipboardList, PackageCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import { DeptSelect, EmptyRow, FieldRow, FilterBar, HeadRow, matches, MonthYearPicker, SearchBox, TableCard, Td, Th } from "@/components/hospital/kit";
import { DEPT_GROUPS, GENERAL_DEPT_ID, findDepartment, sortDepartments } from "@/lib/hospital/constants";
import { stockStatus } from "@/lib/hospital/finance";
import { dateLabel, int, isoDate, money, periodOf } from "@/lib/hospital/format";
import { consumptionByDepartment } from "@/lib/hospital/store-report";
import {
  addStockMove,
  canSpendDirectly,
  deleteStockItem,
  deleteStockMove,
  deliverIssueOrder,
  listLabel,
  newId,
  saveStockItem,
  useCan,
  useHospitalDB,
  useHospitalSession,
  type StockItem,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/stock")({
  head: () => ({
    meta: [
      { title: "المخزن العام — مستهلكات كل الأقسام | مستشفى الرحمة التخصصي" },
      { name: "description", content: "كل أدوية ومستلزمات ومستهلكات أقسام المستشفى في مخزن واحد: أرصدة، صلاحيات، طلبات الأقسام واستهلاك كل قسم." },
      { property: "og:title", content: "المخزن العام | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "مستهلكات كل الأقسام: أرصدة وصلاحيات واستهلاك وتنبيهات إعادة الطلب." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StockPage,
});

function StockPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canAdd = useCan("stock", "add");
  const canEdit = useCan("stock");
  const canIssueDirect = canEdit && !!me && canSpendDirectly(me);
  const today = isoDate(new Date());
  const [tab, setTab] = useState("balances");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [dept, setDept] = useState("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [editing, setEditing] = useState<StockItem | null | "new">(null);
  const [moving, setMoving] = useState<{ item: StockItem; type: "in" | "out" } | null>(null);
  const [history, setHistory] = useState<string>("all");
  const [period, setPeriod] = useState(() => periodOf(new Date()));

  const statuses = useMemo(
    () => new Map(db.stockItems.map((i) => [i.id, stockStatus(i, db.stockMoves, today)])),
    [db.stockItems, db.stockMoves, today],
  );
  const items = useMemo(
    () =>
      db.stockItems
        .map((i) => ({ item: i, st: statuses.get(i.id)! }))
        .filter(
          ({ item, st }) =>
            (cat === "all" || item.category === cat) &&
            (dept === "all" || item.department === dept) &&
            matches(query, item.name, item.unit) &&
            (!inStockOnly || st.balance > 0) &&
            (!alertsOnly || st.belowReorder || st.expiredQty > 0 || st.nearExpiryQty > 0),
        )
        .sort((a, b) => a.item.name.localeCompare(b.item.name, "ar")),
    [db.stockItems, statuses, cat, dept, query, alertsOnly, inStockOnly],
  );
  const all = [...statuses.values()];
  const toDeliver = db.issueOrders.filter((o) => o.status === "approved");
  const moves = useMemo(
    () =>
      db.stockMoves
        .filter((m) => history === "all" || m.itemId === history)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
        .slice(0, 200),
    [db.stockMoves, history],
  );
  const usage = useMemo(() => consumptionByDepartment(db.stockItems, db.stockMoves, period), [db.stockItems, db.stockMoves, period]);
  const usageTotal = usage.reduce((s, d) => s + d.value, 0);

  /** Each department's own store: its items, value and alerts. */
  const perDept = useMemo(() => {
    const m = new Map<string, { count: number; value: number; alerts: number; empty: number }>();
    for (const i of db.stockItems) {
      if (!i.active) continue;
      const st = statuses.get(i.id)!;
      const cur = m.get(i.department) ?? { count: 0, value: 0, alerts: 0, empty: 0 };
      m.set(i.department, {
        count: cur.count + 1,
        value: cur.value + st.value,
        alerts: cur.alerts + (st.belowReorder || st.expiredQty > 0 || st.nearExpiryQty > 0 ? 1 : 0),
        empty: cur.empty + (st.balance <= 0 ? 1 : 0),
      });
    }
    return m;
  }, [db.stockItems, statuses]);
  const deptsWithItems = sortDepartments(db.departments).filter((d) => perDept.has(d.id));

  function openDept(id: string) {
    setDept(id);
    setTab("balances");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المخازن"
        title="المخزن العام — مستهلكات كل الأقسام"
        description="كل أدوية ومستلزمات ومستهلكات المستشفى من كل الأقسام في مخزن واحد. الأقسام تطلب ما تحتاجه، والمدير المالي يعتمد، ثم يسلّم أمين المخزن ويُخصم بأقرب صلاحية أولًا."
        actions={
          <>
            {canAdd && (
              <Button onClick={() => setEditing("new")}>
                <Plus /> صنف جديد
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/orders">طلبات الأقسام والطلبيات</Link>
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="عدد الأصناف" value={int(db.stockItems.length)} hint={`${int(deptsWithItems.length)} قسم`} icon={Boxes} />
        <StatCard label="قيمة المخزون" value={money(all.reduce((s, x) => s + x.value, 0))} hint="ج.م بالتكلفة" icon={Boxes} tone="primary" />
        <StatCard label="تحت حد الطلب" value={int(all.filter((x) => x.belowReorder).length)} icon={AlertTriangle} tone="copper" />
        <StatCard label="منتهي أو قارب الانتهاء" value={int(all.filter((x) => x.expiredQty > 0 || x.nearExpiryQty > 0).length)} icon={CalendarClock} tone="expense" />
        <StatCard label="طلبات معتمدة للتسليم" value={int(toDeliver.length)} icon={PackageCheck} tone={toDeliver.length ? "copper" : "default"} />
      </div>

      {toDeliver.length > 0 && (
        <section className="ledger-card mb-6 overflow-hidden">
          <div className="flex items-center justify-between border-b bg-secondary/60 px-4 py-3">
            <h2 className="font-bold">طلبات أقسام اعتمدها المدير المالي — بانتظار التسليم</h2>
            <Link to="/orders" className="text-xs text-primary hover:underline">
              كل الطلبات
            </Link>
          </div>
          <ul>
            {toDeliver.map((o) => (
              <li key={o.id} className="flex flex-col gap-2 border-b px-4 py-3 last:border-0 md:flex-row md:items-center">
                <span className="font-mono text-xs" dir="ltr">
                  {o.number}
                </span>
                <DeptBadge id={o.department} />
                <p className="min-w-0 flex-1 text-sm">
                  {o.lines.map((l) => `${db.stockItems.find((i) => i.id === l.stockItemId)?.name ?? "صنف"} (${l.qty})`).join("، ")}
                  <span className="block text-[11px] text-muted-foreground">المستلم {o.receiver} • اعتمده {o.decidedBy}</span>
                </p>
                {canAdd && (
                  <Button size="sm" onClick={() => deliverIssueOrder(o.id, today) && toast.success("تم التسليم وخصم الكميات.")}>
                    <PackageCheck /> تسليم
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList className="mb-6 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-muted p-1">
          <TabsTrigger value="balances" className="flex-none gap-1.5">
            <Boxes className="size-4" /> الأرصدة
          </TabsTrigger>
          <TabsTrigger value="depts" className="flex-none gap-1.5">
            <Building2 className="size-4" /> مخزن كل قسم
          </TabsTrigger>
          <TabsTrigger value="usage" className="flex-none gap-1.5">
            <ClipboardList className="size-4" /> استهلاك الأقسام
          </TabsTrigger>
          <TabsTrigger value="moves" className="flex-none gap-1.5">
            <ArrowUpFromLine className="size-4" /> الحركات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="balances">
          <FilterBar>
            <DeptSelect value={dept} onChange={setDept} allowAll className="md:w-60" label="القسم" />
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="bg-card md:w-60" aria-label="التصنيف">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">كل التصنيفات</SelectItem>
                {db.lists.stockCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchBox value={query} onChange={setQuery} placeholder="اسم الصنف" className="md:flex-1" />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={inStockOnly} onCheckedChange={(c) => setInStockOnly(c === true)} /> المتوفر فقط
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={alertsOnly} onCheckedChange={(c) => setAlertsOnly(c === true)} /> التنبيهات فقط
            </label>
          </FilterBar>
          <p className="mb-2 text-xs text-muted-foreground">
            {int(items.length)} صنف{dept !== "all" ? ` في ${findDepartment(db.departments, dept).name}` : ""}
          </p>
          <TableCard minWidth={1000}>
            <thead>
              <HeadRow>
                <Th>الصنف</Th>
                <Th>التصنيف / القسم</Th>
                <Th num>الرصيد</Th>
                <Th num>حد الطلب</Th>
                <Th>أقرب صلاحية</Th>
                <Th num>القيمة</Th>
                <Th className="w-48" />
              </HeadRow>
            </thead>
            <tbody>
              {items.map(({ item, st }) => (
                <tr key={item.id} className={cn("border-b last:border-0 hover:bg-muted/50", !item.active && "opacity-60")}>
                  <Td>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{item.unit}{!item.active ? " • موقوف" : ""}</p>
                  </Td>
                  <Td className="text-xs">
                    <p className="mb-1">{listLabel(db.lists.stockCategories, item.category)}</p>
                    <DeptBadge id={item.department} />
                  </Td>
                  <Td num className={cn("font-bold", st.balance <= 0 ? "text-muted-foreground" : st.belowReorder && "text-copper")}>
                    {st.balance}
                  </Td>
                  <Td num>{item.reorderLevel}</Td>
                  <Td className="text-xs">
                    {st.nextExpiry ? dateLabel(st.nextExpiry) : "—"}
                    {st.expiredQty > 0 && <p className="font-semibold text-destructive">منتهي: {st.expiredQty}</p>}
                    {st.nearExpiryQty > 0 && <p className="text-copper">قارب الانتهاء: {st.nearExpiryQty}</p>}
                  </Td>
                  <Td num>{money(st.value)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      {canAdd && (
                        <Button size="icon" variant="ghost" aria-label="إضافة رصيد" title="إضافة رصيد" onClick={() => setMoving({ item, type: "in" })}>
                          <ArrowDownToLine />
                        </Button>
                      )}
                      {canIssueDirect && (
                        <Button size="icon" variant="ghost" aria-label="إعدام / صرف مباشر" title="إعدام / صرف مباشر" onClick={() => setMoving({ item, type: "out" })}>
                          <ArrowUpFromLine />
                        </Button>
                      )}
                      {canEdit && (
                        <>
                          <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setEditing(item)}>
                            <Pencil />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label="حذف" className="text-muted-foreground hover:text-destructive" onClick={() => window.confirm(`حذف ${item.name}؟`) && deleteStockItem(item.id)}>
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {!items.length && <EmptyRow cols={7} text="لا توجد أصناف بهذه الفلاتر." />}
            </tbody>
          </TableCard>
        </TabsContent>

        <TabsContent value="depts">
          <div className="space-y-6">
            {DEPT_GROUPS.map((g) => {
              const ds = deptsWithItems.filter((d) => d.group === g.id);
              if (!ds.length) return null;
              return (
                <section key={g.id}>
                  <h2 className="mb-2 text-sm font-bold text-copper">{g.name}</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {ds.map((d) => {
                      const x = perDept.get(d.id)!;
                      const c = findDepartment(db.departments, d.id);
                      return (
                        <button key={d.id} type="button" onClick={() => openDept(d.id)} className="ledger-card p-4 text-right transition-colors hover:border-primary/40 hover:bg-muted/40">
                          <p className="flex items-center gap-2 font-semibold">
                            <span className={cn("size-2.5 rounded-full", c.dot)} /> {d.name}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            <span className="num font-semibold text-foreground">{int(x.count)}</span> صنف •{" "}
                            <span className="num">{money(x.value)}</span> ج.م
                          </p>
                          <p className="mt-1 text-[11px]">
                            {x.alerts > 0 ? <span className="text-copper">{int(x.alerts)} تنبيه</span> : <span className="text-income">بدون تنبيهات</span>}
                            {x.empty > 0 && <span className="text-muted-foreground"> • {int(x.empty)} بدون رصيد</span>}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="usage">
          <FilterBar>
            <MonthYearPicker period={period} onChange={setPeriod} allowAll />
            <p className="text-sm text-muted-foreground md:mr-auto">
              إجمالي المنصرف للأقسام: <b className="num text-foreground">{money(usageTotal)}</b> ج.م
            </p>
          </FilterBar>
          <div className="grid gap-4 lg:grid-cols-2">
            {usage.map((u) => (
              <section key={u.department} className="ledger-card overflow-hidden">
                <div className="flex items-center justify-between border-b bg-secondary/60 px-4 py-2.5">
                  <DeptBadge id={u.department} />
                  <span className="num text-sm font-bold">{money(u.value)} ج.م</span>
                </div>
                <ul className="divide-y text-sm">
                  {u.items.slice(0, 8).map((r) => (
                    <li key={r.itemId} className="flex items-center justify-between px-4 py-2">
                      <span>{r.name}</span>
                      <span className="num text-xs text-muted-foreground">
                        {r.qty} {r.unit} • {money(r.value)}
                      </span>
                    </li>
                  ))}
                  {u.items.length > 8 && <li className="px-4 py-2 text-xs text-muted-foreground">و{int(u.items.length - 8)} صنف آخر</li>}
                </ul>
              </section>
            ))}
            {!usage.length && <p className="ledger-card p-10 text-center text-muted-foreground lg:col-span-2">لا يوجد صرف للأقسام في هذه الفترة.</p>}
          </div>
        </TabsContent>

        <TabsContent value="moves">
          <div className="mb-3 flex justify-end">
            <Select value={history} onValueChange={setHistory}>
              <SelectTrigger className="bg-card sm:w-64" aria-label="الصنف">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">كل الأصناف</SelectItem>
                {db.stockItems
                  .filter((i) => db.stockMoves.some((m) => m.itemId === i.id))
                  .map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <TableCard minWidth={860}>
            <thead>
              <HeadRow>
                <Th>التاريخ</Th>
                <Th>الصنف</Th>
                <Th>النوع</Th>
                <Th num>الكمية</Th>
                <Th>التشغيلة / الصلاحية</Th>
                <Th>البيان</Th>
                <Th className="w-12" />
              </HeadRow>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className="border-b last:border-0 hover:bg-muted/50">
                  <Td num className="text-right">
                    {dateLabel(m.date)}
                  </Td>
                  <Td>{db.stockItems.find((i) => i.id === m.itemId)?.name ?? "—"}</Td>
                  <Td>
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", m.type === "in" ? "bg-income/10 text-income" : "bg-expense/10 text-expense")}>
                      {m.type === "in" ? "وارد" : "منصرف"}
                    </span>
                  </Td>
                  <Td num>{m.qty}</Td>
                  <Td className="text-xs">
                    {m.batchNo || "—"}
                    {m.expiry && <p className="text-muted-foreground">{dateLabel(m.expiry)}</p>}
                  </Td>
                  <Td className="text-xs">
                    {m.note || m.supplierName || ""}
                    {m.department && <p className="text-muted-foreground">{findDepartment(db.departments, m.department).name}</p>}
                  </Td>
                  <Td>
                    {canEdit && !m.id.startsWith("iss-") && !m.id.startsWith("grn-") && (
                      <Button size="icon" variant="ghost" aria-label="حذف الحركة" className="text-muted-foreground hover:text-destructive" onClick={() => window.confirm("حذف الحركة؟") && deleteStockMove(m.id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
              {!moves.length && <EmptyRow cols={7} text="لا توجد حركات." />}
            </tbody>
          </TableCard>
        </TabsContent>
      </Tabs>

      <ItemDialog open={editing !== null} item={editing === "new" ? null : editing} defaultDept={dept} onOpenChange={(o) => !o && setEditing(null)} />
      <MoveDialog move={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

function ItemDialog({ open, item, defaultDept, onOpenChange }: { open: boolean; item: StockItem | null; defaultDept: string; onOpenChange: (o: boolean) => void }) {
  const db = useHospitalDB();
  const [f, setF] = useState<StockItem>({ id: "", name: "", unit: "", category: "", department: GENERAL_DEPT_ID, reorderLevel: 0, active: true });
  useEffect(() => {
    if (open)
      setF(item ?? { id: newId(), name: "", unit: "علبة", category: db.lists.stockCategories[0]?.id ?? "", department: defaultDept !== "all" ? defaultDept : "pharmacy", reorderLevel: 10, active: true });
  }, [open, item, db.lists.stockCategories, defaultDept]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">{item ? "تعديل صنف" : "صنف جديد"}</DialogTitle>
          <DialogDescription>بيانات الصنف وحد إعادة الطلب.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const department = db.departments.some((d) => d.id === f.department) ? f.department : GENERAL_DEPT_ID;
            if (saveStockItem({ ...f, department, name: f.name.trim(), reorderLevel: Number(f.reorderLevel) || 0 })) {
              toast.success("تم حفظ الصنف.");
              onOpenChange(false);
            }
          }}
        >
          <FieldRow label="اسم الصنف" htmlFor="si-name">
            <Input id="si-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="الوحدة" htmlFor="si-unit">
              <Input id="si-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="علبة، أمبول، قطعة" />
            </FieldRow>
            <FieldRow label="حد إعادة الطلب" htmlFor="si-re">
              <Input id="si-re" type="number" min="0" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: Number(e.target.value) })} />
            </FieldRow>
            <FieldRow label="التصنيف">
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger aria-label="التصنيف">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {db.lists.stockCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="القسم المستخدم">
              <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
            </FieldRow>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.active} onCheckedChange={(c) => setF({ ...f, active: c === true })} /> صنف نشط
          </label>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ move, onClose }: { move: { item: StockItem; type: "in" | "out" } | null; onClose: () => void }) {
  const [f, setF] = useState({ date: "", qty: "", batchNo: "", expiry: "", unitCost: "", supplierName: "", department: "", note: "" });
  useEffect(() => {
    if (move) setF({ date: isoDate(new Date()), qty: "", batchNo: "", expiry: "", unitCost: "", supplierName: "", department: move.item.department, note: "" });
  }, [move]);
  if (!move) return null;
  const isIn = move.type === "in";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="font-display text-2xl">
            {isIn ? "إضافة رصيد" : "إعدام / صرف مباشر"} — {move.item.name}
          </DialogTitle>
          <DialogDescription>{isIn ? "رصيد افتتاحي أو إضافة مباشرة. استلام الموردين من صفحة الطلبيات." : "صرف الأقسام يتم بطلب يعتمده المدير المالي؛ هذا للإعدام والتسويات فقط."}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const ok = addStockMove({
              itemId: move.item.id,
              date: f.date,
              type: move.type,
              qty: Number(f.qty) || 0,
              batchNo: isIn ? f.batchNo || undefined : undefined,
              expiry: isIn ? f.expiry || undefined : undefined,
              unitCost: isIn ? Number(f.unitCost) || 0 : undefined,
              supplierName: isIn ? f.supplierName || undefined : undefined,
              department: isIn ? undefined : f.department,
              note: f.note || undefined,
            });
            if (ok) {
              toast.success("تم تسجيل الحركة.");
              onClose();
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow label="التاريخ" htmlFor="mv-date">
              <Input id="mv-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </FieldRow>
            <FieldRow label={`الكمية (${move.item.unit})`} htmlFor="mv-qty">
              <Input id="mv-qty" type="number" min="0" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
            </FieldRow>
            {isIn ? (
              <>
                <FieldRow label="رقم التشغيلة" htmlFor="mv-batch">
                  <Input id="mv-batch" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
                </FieldRow>
                <FieldRow label="تاريخ الصلاحية" htmlFor="mv-exp">
                  <Input id="mv-exp" type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} />
                </FieldRow>
                <FieldRow label="تكلفة الوحدة" htmlFor="mv-cost">
                  <Input id="mv-cost" type="number" min="0" step="0.01" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} />
                </FieldRow>
                <FieldRow label="المورد (اختياري)" htmlFor="mv-sup">
                  <Input id="mv-sup" value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} />
                </FieldRow>
              </>
            ) : (
              <FieldRow label="القسم" className="sm:col-span-2">
                <DeptSelect value={f.department} onChange={(v) => setF({ ...f, department: v })} />
              </FieldRow>
            )}
          </div>
          <FieldRow label="البيان" htmlFor="mv-note">
            <Input id="mv-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={isIn ? "رصيد افتتاحي" : "إعدام منتهي الصلاحية"} />
          </FieldRow>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit">حفظ</Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
