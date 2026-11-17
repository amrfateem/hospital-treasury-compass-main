import { createFileRoute, Link } from "@tanstack/react-router";
import { BedDouble, CalendarDays, FileOutput, FileText, HandCoins, ListChecks, Lock, MoreHorizontal, Pencil, Plus, Printer, Receipt, ReceiptText, Trash2, Undo2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeptBadge, PageHeader, StatCard } from "@/components/hospital/ui";
import {
  EmptyRow,
  HeadRow,
  matches,
  MonthYearPicker,
  SearchBox,
  TableCard,
  Td,
  Th,
  usePdfExport,
} from "@/components/hospital/kit";
import { InvoiceDialog } from "@/components/hospital/billing/InvoiceDialog";
import { ReceiptPrinterMenu } from "@/components/hospital/billing/ReceiptPrinterMenu";
import { ReceiptDocument } from "@/components/hospital/billing/ReceiptDocument";
import { DESK_ICONS } from "@/components/hospital/billing/desks";
import { RefundDialog } from "@/components/hospital/refunds/RefundDialog";
import { deskOf, RECEIPT_DESKS, type ReceiptDeskKey } from "@/lib/hospital/catalog";
import { dateLabel, int, isoDate, money, periodOf } from "@/lib/hospital/format";
import { invoiceAmounts } from "@/lib/hospital/finance";
import { patientMoney } from "@/lib/hospital/patient-money";
import { exportedIds, invoiceContext } from "@/lib/hospital/invoice-export";
import { useReceiptPrinter } from "@/lib/hospital/receipt-printer";
import { printHtml, thermalReceiptHtml } from "@/lib/hospital/thermal-receipt";
import { needsReceiptApproval } from "@/lib/hospital/permissions";
import {
  canReceptionEdit,
  deletePatientInvoice,
  listLabel,
  markInvoicePrinted,
  requestInvoiceChange,
  useCan,
  useHospitalDB,
  useHospitalSession,
  type PatientInvoice,
} from "@/lib/hospital/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "إيصالات المرضى بالأقسام | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "إيصالات العيادات والطوارئ والمعمل والأشعة والعناية المركزة بقوائم أسعار كل قسم وطباعة A4 وA5 وتسجيل تلقائي بالخزينة.",
      },
      { property: "og:title", content: "إيصالات المرضى | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "إيصالات الأقسام الطبية مرتبطة بالخزينة ومراكز التكلفة ومستحقات الأطباء والتأمين.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  const db = useHospitalDB();
  const { me } = useHospitalSession();
  const canEdit = useCan("billing");
  const canServices = useCan("settings");
  const [printer, setPrinter] = useReceiptPrinter();
  // Everyone but the director asks the finance manager before changing a printed receipt or cancelling any receipt.
  const asks = !!me && needsReceiptApproval(me);
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [desk, setDesk] = useState<ReceiptDeskKey | "all">("all");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "today" | "rest">("all");
  const [open, setOpen] = useState(false);
  const [newDesk, setNewDesk] = useState<ReceiptDeskKey>("clinics");
  const [editing, setEditing] = useState<PatientInvoice | null>(null);
  const [job, setJob] = useState<{ inv: PatientInvoice; format: "a4" | "a5" } | null>(null);
  const [refundOf, setRefundOf] = useState<PatientInvoice | null>(null);
  const canAdd = useCan("billing", "add");
  const pdf = usePdfExport();

  useEffect(() => {
    if (!job) return;
    const id = requestAnimationFrame(() => {
      void pdf
        .run(`إيصال-${job.inv.number}-${job.format.toUpperCase()}.pdf`, "تم تصدير الإيصال.")
        .then(() => {
          if (!job.inv.printedAt) markInvoicePrinted(job.inv.id);
        })
        .finally(() => setJob(null));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const exported = useMemo(() => exportedIds(db.invoiceExports), [db.invoiceExports]);
  const inPeriod = useMemo(
    () => db.patientInvoices.filter((i) => period === "all" || i.date.startsWith(period)),
    [db.patientInvoices, period],
  );
  const today = isoDate(new Date());
  const deskStats = useMemo(() => {
    const m = new Map<ReceiptDeskKey, { count: number; total: number; today: number }>();
    for (const i of inPeriod) {
      const k = deskOf(i.department).key;
      const s = m.get(k) ?? { count: 0, total: 0, today: 0 };
      const t = invoiceAmounts(i).total;
      s.count += 1;
      s.total += t;
      if (i.date === today) s.today += t;
      m.set(k, s);
    }
    return m;
  }, [inPeriod, today]);

  const rows = useMemo(() => {
    const list = inPeriod
      .filter(
        (i) =>
          (desk === "all" || deskOf(i.department).key === desk) &&
          (show !== "today" || i.date === today) &&
          matches(query, i.patientName, i.number, i.patientPhone, i.patientMrn, ...i.items.map((x) => x.description)),
      )
      .map((i) => {
        const a = invoiceAmounts(i);
        // Unpaid part kept on the patient's own account (not a company / installment account).
        const rest = i.credit?.accountId.startsWith("pt-") ? a.credit : 0;
        return { inv: i, a, c: invoiceContext(db, i), rest };
      })
      .filter((r) => show !== "rest" || r.rest > 0)
      .sort((a, b) => b.inv.date.localeCompare(a.inv.date) || b.inv.createdAt - a.inv.createdAt);
    return list;
  }, [inPeriod, desk, query, show, today, db]);
  // What each patient still owes now (after later collections), to mark settled receipts.
  const owedNow = useMemo(() => {
    const ids = [...new Set(rows.filter((r) => r.rest > 0 && r.inv.patientId).map((r) => r.inv.patientId!))];
    return ids.length ? patientMoney(db, ids) : {};
  }, [rows, db]);
  const days = useMemo(() => {
    const out: { date: string; items: typeof rows; total: number }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.date === r.inv.date) {
        last.items.push(r);
        last.total += r.a.total;
      } else out.push({ date: r.inv.date, items: [r], total: r.a.total });
    }
    return out;
  }, [rows]);
  const total = rows.reduce((s, r) => s + r.a.total, 0);
  const collected = rows.reduce((s, r) => s + r.a.paidNow, 0);
  const discounts = rows.reduce((s, r) => s + r.a.discount, 0);
  const restTotal = rows.reduce((s, r) => s + r.rest, 0);
  const insurer = rows.reduce((s, r) => s + r.a.insurerShare, 0);
  const pendingReq = new Set(db.editRequests.filter((r) => r.status === "pending").map((r) => r.invoiceId));
  const refunded = new Set(db.refunds.filter((r) => r.status !== "rejected").map((r) => r.invoiceId));

  function openNew(k: ReceiptDeskKey) {
    setEditing(null);
    setNewDesk(k);
    setOpen(true);
  }

  /** Prints on the receipt (thermal) printer; the first print locks the receipt like A4/A5. */
  function printReceipt(inv: PatientInvoice) {
    const html = thermalReceiptHtml(db, inv, {
      width: printer.width,
      copies: printer.copies,
      reprint: !!inv.printedAt,
      printedAt: Date.now(),
    });
    void printHtml(html).then(() => {
      if (!inv.printedAt) markInvoicePrinted(inv.id);
    });
  }

  function testPrint() {
    const sample: PatientInvoice = {
      id: "test",
      number: "TEST-0001",
      date: today,
      patientName: "طباعة تجريبية",
      department: "clinics",
      items: [{ description: "كشف أخصائي", qty: 1, unitPrice: 300 }],
      discount: 0,
      paymentMethod: db.lists.paymentMethods[0]?.id ?? "cash",
      createdAt: Date.now(),
      createdBy: me?.name,
    };
    void printHtml(thermalReceiptHtml(db, sample, { width: printer.width, copies: 1, printedAt: Date.now() }));
  }

  function askChange(inv: PatientInvoice, action: "edit" | "delete") {
    const reason = window.prompt(
      `${action === "edit" ? `الإيصال ${inv.number} مطبوع. اكتب سبب طلب التعديل` : `اكتب سبب طلب إلغاء الإيصال ${inv.number}`} ليعتمده ${me?.role === "finance" ? "مدير المستشفى" : "المدير المالي"}:`,
    );
    if (reason === null) return;
    if (!reason.trim()) { toast.error("اكتب سبب الطلب."); return; }
    if (requestInvoiceChange(inv.id, action, reason)) toast.success("أُرسل الطلب للاعتماد — لن يتغير الإيصال قبل الموافقة.");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="إيرادات الأقسام"
        title="إيصالات المرضى"
        description="اختر القسم لعمل الإيصال: العيادات، الطوارئ، المعمل، الأشعة، العمليات، العناية أو الصيدلية — كل قسم بقائمة أسعاره، ويُسجَّل الإيصال تلقائيًا في الخزينة."
        actions={
          <div className="flex flex-wrap gap-2">
            <ReceiptPrinterMenu prefs={printer} onChange={setPrinter} onTest={testPrint} />
            {canServices && (
              <Button variant="outline" asChild>
                <Link to="/services">
                  <ListChecks /> الخدمات والأسعار
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/admissions">
                <BedDouble /> المرضى المقيمون
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/refunds">
                <Undo2 /> المرتجعات
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/invoice-exports">
                <FileOutput /> إدارة تصدير الفواتير
              </Link>
            </Button>
            {canEdit && (
              <Button onClick={() => openNew(desk === "all" ? "clinics" : desk)}>
                <Plus /> إيصال جديد
              </Button>
            )}
          </div>
        }
      />

      {/* One card per receipt desk */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        {RECEIPT_DESKS.map((d) => {
          const Icon = DESK_ICONS[d.key];
          const s = deskStats.get(d.key);
          const active = desk === d.key;
          return (
            <div
              key={d.key}
              className={cn(
                "ledger-card flex flex-col gap-2 p-3 transition-colors",
                active && "ring-2 ring-primary",
              )}
            >
              <button
                type="button"
                onClick={() => setDesk(active ? "all" : d.key)}
                className="flex items-center gap-2 text-right"
                aria-pressed={active}
                aria-label={`عرض إيصالات ${d.label}`}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-bold">{d.label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {int(s?.count ?? 0)} إيصال — <span className="num">{money(s?.total ?? 0)}</span>
                  </span>
                </span>
              </button>
              {canEdit && (
                <Button size="sm" variant="secondary" className="h-8" onClick={() => openNew(d.key)}>
                  <Plus /> إيصال جديد
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="ledger-card mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <MonthYearPicker period={period} onChange={setPeriod} allowAll />
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="عرض الإيصالات">
            {(
              [
                ["all", "الكل"],
                ["today", "إيصالات اليوم"],
                ["rest", "عليها متبقٍ"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)} className={cn("chip-filter", show === k && "chip-filter-active")}>
                {label}
              </button>
            ))}
          </div>
          {desk !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setDesk("all")}>
              كل الأقسام
            </Button>
          )}
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder="اسم المريض، رقم الملف أو رقم الإيصال" className="sm:w-80" />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="عدد الإيصالات" value={int(rows.length)} icon={FileText} />
        <StatCard label="صافي الإيرادات" value={money(total)} icon={Wallet} tone="income" hint={discounts ? `بعد خصومات ${money(discounts)}` : "بالجنيه المصري"} />
        <StatCard label="المدفوع في الخزينة" value={money(collected)} icon={Receipt} hint={insurer ? `${money(insurer)} على جهات التعاقد` : undefined} />
        <StatCard label="المتبقي على المرضى" value={money(restTotal)} icon={HandCoins} tone="expense" hint="من إيصالات هذه الفترة" />
      </div>

      <TableCard minWidth={900}>
        <thead>
          <HeadRow>
            <Th>رقم الإيصال</Th>
            <Th>المريض والخدمات</Th>
            <Th>القسم</Th>
            <Th num>الصافي</Th>
            <Th num>المدفوع</Th>
            <Th num>المتبقي</Th>
            <Th className="text-left">إجراءات</Th>
          </HeadRow>
        </thead>
        <tbody>
          {days.map((day) => (
            <DayRows key={day.date} date={day.date} today={today} count={day.items.length} total={day.total}>
              {day.items.map(({ inv, a, c, rest }) => {
                const fromStay = !!inv.admissionId;
                const locked = fromStay || (asks && !canReceptionEdit(inv));
                const settled = rest > 0 && inv.patientId && owedNow[inv.patientId]?.remaining === 0;
                return (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/50">
                    <Td className="font-mono text-xs">
                      <span dir="ltr">{inv.number}</span>
                      <div className="mt-1 flex flex-wrap gap-1 font-sans">
                        {inv.printedAt && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">مطبوع</span>}
                        {exported.has(inv.id) && <span className="rounded bg-primary/10 px-1.5 text-[10px] text-primary">مُصدَّر</span>}
                        {pendingReq.has(inv.id) && <span className="rounded bg-copper/15 px-1.5 text-[10px] text-copper">طلب قيد الاعتماد</span>}
                        {fromStay && <span className="rounded bg-primary/10 px-1.5 text-[10px] text-primary">فاتورة خروج مقيم</span>}
                        {refunded.has(inv.id) && <span className="rounded bg-expense/10 px-1.5 text-[10px] text-expense">عليه مرتجع</span>}
                      </div>
                    </Td>
                    <Td>
                      <p className="font-semibold">
                        {inv.patientName}
                        {inv.patientMrn && (
                          <span className="num mr-1.5 text-[11px] font-normal text-muted-foreground" dir="ltr">
                            {inv.patientMrn}
                          </span>
                        )}
                      </p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {[...(a.days ? [`إقامة ${int(a.days)} يوم`] : []), ...inv.items.map((i) => i.description)].join("، ")}
                      </p>
                    </Td>
                    <Td>
                      <DeptBadge id={inv.department} />
                      {(c.clinic || c.referredBy || c.doctor) && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {[c.clinic && `عيادة ${c.clinic}`, c.referredBy && `محوَّل من ${c.referredBy}`, c.doctor && `د. ${c.doctor}`]
                            .filter(Boolean)
                            .join(" — ")}
                        </p>
                      )}
                    </Td>
                    <Td num>{money(a.total)}</Td>
                    <Td num>
                      <p className="font-bold text-income">{money(a.paidNow)}</p>
                      <p className="text-[11px] font-normal text-muted-foreground">
                        {listLabel(db.lists.paymentMethods, inv.paymentMethod)}
                        {inv.payer ? ` • ${listLabel(db.lists.payers, inv.payer.payerId)} ${int(a.coverage)}٪` : ""}
                      </p>
                    </Td>
                    <Td num>
                      {rest > 0 ? (
                        <span className={cn("rest-chip", settled && "rest-chip-done")}>
                          {money(rest)}
                          {settled ? " — سُدِّد" : ""}
                        </span>
                      ) : a.credit > 0 ? (
                        <span className="text-[11px] text-muted-foreground">آجل {money(a.credit)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" className="px-2" aria-label="طباعة على طابعة الإيصالات" onClick={() => printReceipt(inv)}>
                          <ReceiptText /> طباعة
                        </Button>
                        {canEdit && locked && !fromStay && (
                          <Button variant="ghost" size="sm" className="px-2" disabled={pendingReq.has(inv.id)} onClick={() => askChange(inv, "edit")} aria-label="طلب تعديل من المدير">
                            <Lock /> طلب تعديل
                          </Button>
                        )}
                        {canEdit && !locked && (
                          <Button variant="ghost" size="icon" aria-label="تعديل الإيصال" onClick={() => { setEditing(inv); setOpen(true); }}>
                            <Pencil />
                          </Button>
                        )}
                        <DropdownMenu dir="rtl">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`خيارات أخرى للإيصال ${inv.number}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={!!job} onSelect={() => setJob({ inv, format: "a4" })}>
                              <Printer /> طباعة A4
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!!job} onSelect={() => setJob({ inv, format: "a5" })}>
                              <Printer /> طباعة A5
                            </DropdownMenuItem>
                            {canAdd && a.paidNow > 0 && (
                              <DropdownMenuItem onSelect={() => setRefundOf(inv)}>
                                <Undo2 /> مرتجع للمريض (إلغاء خدمة)
                              </DropdownMenuItem>
                            )}
                            {fromStay && (
                              <DropdownMenuItem asChild>
                                <Link to="/admissions">
                                  <BedDouble /> فتح حساب الإقامة
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {canEdit && !fromStay && (asks || !locked) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  disabled={asks && pendingReq.has(inv.id)}
                                  onSelect={() => {
                                    if (asks) {
                                      askChange(inv, "delete");
                                      return;
                                    }
                                    if (window.confirm(`حذف الإيصال ${inv.number}؟ سيُحذف قيده من الخزينة أيضًا.`)) {
                                      if (deletePatientInvoice(inv.id)) toast.success("تم حذف الإيصال وقيده.");
                                    }
                                  }}
                                >
                                  <Trash2 /> {asks ? "طلب إلغاء الإيصال (بموافقة)" : "حذف الإيصال"}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </DayRows>
          ))}
          {!rows.length && (
            <EmptyRow cols={7} text={show === "rest" ? "لا توجد إيصالات عليها متبقٍ في هذه الفترة." : show === "today" ? "لا توجد إيصالات اليوم بعد." : "لا توجد إيصالات في هذه الفترة."} />
          )}
        </tbody>
      </TableCard>

      <InvoiceDialog
        open={open}
        onOpenChange={setOpen}
        invoice={editing}
        defaultDesk={newDesk}
        onSaved={(inv, isEdit) => {
          const auto = !isEdit && printer.autoPrint;
          if (auto) printReceipt(inv);
          toast.success(
            isEdit
              ? `تم تعديل الإيصال ${inv.number} وتحديث قيده بالخزينة.`
              : auto
                ? `تم حفظ الإيصال ${inv.number} وإرساله لطابعة الإيصالات.`
                : `تم حفظ الإيصال ${inv.number} وتسجيله بالخزينة.`,
            {
              action: auto
                ? { label: "طباعة A5", onClick: () => setJob({ inv, format: "a5" }) }
                : { label: "طباعة الإيصال", onClick: () => printReceipt(inv) },
            },
          );
        }}
      />

      <RefundDialog invoice={refundOf} onOpenChange={(o) => !o && setRefundOf(null)} />

      {job && <ReceiptDocument ref={pdf.ref} db={db} invoice={job.inv} format={job.format} />}
    </div>
  );
}

const weekday = new Intl.DateTimeFormat("ar-EG", { weekday: "long" });

/** One header row per day (newest first) so the desk sees today's receipts together. */
function DayRows({ date, today, count, total, children }: { date: string; today: string; count: number; total: number; children: React.ReactNode }) {
  const yesterday = isoDate(new Date(Date.now() - 86_400_000));
  const name = date === today ? "اليوم" : date === yesterday ? "أمس" : weekday.format(new Date(`${date}T12:00:00`));
  return (
    <>
      <tr className="day-row border-b">
        <td colSpan={7} className="px-4 py-1.5">
          <span className="flex items-center gap-2">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            <b>{name}</b>
            <span className="num text-muted-foreground">{dateLabel(date)}</span>
            <span className="mr-auto text-muted-foreground">
              <span className="num">{int(count)}</span> إيصال — <b className="num text-foreground">{money(total)}</b> ج.م
            </span>
          </span>
        </td>
      </tr>
      {children}
    </>
  );
}
