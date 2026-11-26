import { Link, Navigate, useRouterState } from "@tanstack/react-router";
import {
  BadgePercent,
  BookOpen,
  Boxes,
  FileBadge,
  Landmark,
  CalendarCheck,
  CalendarCheck2,
  ClipboardList,
  CloudUpload,
  Coins,
  Eye,
  FileOutput,
  FileSearch,
  PackageCheck,
  ShieldCheck,
  ShieldAlert,
  TrendingDown,
  HeartPulse,
  ListChecks,
  LayoutDashboard,
  LogOut,
  Menu,
  PieChart,
  Pill,
  Receipt,
  Settings,
  Stethoscope,
  Timer,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
  HandCoins,
  NotebookPen,
  Target,
  FolderHeart,
  IdCard,
  BedDouble,
  Undo2,
  Banknote,
  Cloud,
  CloudOff,
  RefreshCw,
  Scale,
  FileStack,
  Wrench,
  BarChart3,
  ReceiptText,
  HandHelping,
  Gem,
  CalendarRange,
  CalendarClock,
  FlaskConical,
  ChevronDown,
  Search,
  HardDriveDownload,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { HOSPITAL } from "@/lib/hospital/constants";
import {
  findBox,
  forgetLegacyDeviceData,
  hasRecords,
  readLegacyDeviceData,
  restoreBackup,
  ROLE_LABELS,
  useHospitalSession,
  useSyncStatus,
} from "@/lib/hospital/store";
import { can, type PermActor, type Section } from "@/lib/hospital/permissions";
import { approvableCount } from "@/lib/hospital/approvals";
import { cn } from "@/lib/utils";
import { NotificationsBell, NotificationsPanel } from "@/components/hospital/notifications/NotificationsPanel";
import { ServerAddress } from "@/components/hospital/ServerAddress";
import { acknowledgeRecovery, backupNow, getBackupInfo } from "@/lib/hospital/backup.functions";
import { BACKUP_CHANGED } from "@/lib/hospital/backup-events";

type NavPath =
  | "/"
  | "/treasury"
  | "/shifts"
  | "/daily-closing"
  | "/bank"
  | "/billing"
  | "/admissions"
  | "/refunds"
  | "/advances"
  | "/e-invoicing"
  | "/invoice-exports"
  | "/services"
  | "/insurance"
  | "/doctors"
  | "/expenses"
  | "/revenues-expenses"
  | "/petty-cash"
  | "/orders"
  | "/payroll"
  | "/suppliers"
  | "/supplier-accounts"
  | "/stock"
  | "/inventory"
  | "/review"
  | "/permissions"
  | "/cost-centers"
  | "/closing"
  | "/financial-reports"
  | "/receivables"
  | "/journal"
  | "/budget"
  | "/settings"
  | "/patients"
  | "/staff"
  | "/control"
  | "/revenue-reports"
  | "/payment-reports"
  | "/petty-reports"
  | "/profits"
  | "/fiscal-budget"
  | "/devices"
  | "/file-handover"
  | "/appointments"
  | "/lab";

interface NavItem {
  to: NavPath;
  label: string;
  icon: LucideIcon;
  /** Shown when the person can at least view one of these sections. */
  sections: Section[];
}

/**
 * Side menu, ordered like the hospital's day: reception and patients first, then the money they
 * bring in (treasury), the money going out, people, stock, reports, accounts and control.
 */
const NAV: { group: string; icon: LucideIcon; items: NavItem[] }[] = [
  {
    group: "الرئيسية",
    icon: LayoutDashboard,
    items: [{ to: "/", label: "لوحة التحكم", icon: LayoutDashboard, sections: ["dashboard"] }],
  },
  {
    group: "الاستقبال والمرضى",
    icon: Receipt,
    items: [
      { to: "/billing", label: "إيصالات المرضى", icon: Receipt, sections: ["billing"] },
      { to: "/admissions", label: "المريض المقيم (دخول وخروج)", icon: BedDouble, sections: ["billing"] },
      { to: "/patients", label: "ملفات المرضى والمتبقي", icon: FolderHeart, sections: ["patients"] },
      { to: "/appointments", label: "المواعيد والحجوزات", icon: CalendarClock, sections: ["appointments"] },
      { to: "/lab", label: "طلبات ونتائج المعمل", icon: FlaskConical, sections: ["lab"] },
      { to: "/refunds", label: "مرتجعات المرضى", icon: Undo2, sections: ["billing"] },
      { to: "/file-handover", label: "سركي تسليم الملفات", icon: FileStack, sections: ["fileHandover"] },
    ],
  },
  {
    group: "الأطباء والخدمات",
    icon: Stethoscope,
    items: [
      { to: "/doctors", label: "الأطباء ومستحقاتهم", icon: Stethoscope, sections: ["doctors"] },
      { to: "/services", label: "خدمات الأقسام وأسعارها", icon: ListChecks, sections: ["settings", "billing"] },
    ],
  },
  {
    group: "الخزينة والنقدية",
    icon: Wallet,
    items: [
      { to: "/treasury", label: "الخزائن وحركة النقدية", icon: Wallet, sections: ["treasury"] },
      { to: "/shifts", label: "الورديات وتقفيل الشيفت", icon: Timer, sections: ["shifts"] },
      { to: "/daily-closing", label: "الإقفال اليومي للخزينة", icon: CalendarCheck, sections: ["treasury"] },
      { to: "/bank", label: "البنوك والمطابقة", icon: Landmark, sections: ["bank"] },
    ],
  },
  {
    group: "التأمين والآجل والفواتير",
    icon: BadgePercent,
    items: [
      { to: "/insurance", label: "مستحقات التأمين والتعاقدات", icon: BadgePercent, sections: ["insurance"] },
      { to: "/receivables", label: "حسابات المرضى والشركات (الآجل)", icon: HandCoins, sections: ["receivables"] },
      { to: "/e-invoicing", label: "الفاتورة الإلكترونية والضرائب", icon: FileBadge, sections: ["eInvoicing"] },
      { to: "/invoice-exports", label: "تصدير الفواتير", icon: FileOutput, sections: ["billing"] },
    ],
  },
  {
    group: "المصروفات والمشتريات",
    icon: TrendingDown,
    items: [
      { to: "/expenses", label: "إدارة المصروفات", icon: TrendingDown, sections: ["expenses"] },
      { to: "/petty-cash", label: "النثريات", icon: Coins, sections: ["pettyCash"] },
      { to: "/orders", label: "أوامر الصرف والطلبيات", icon: PackageCheck, sections: ["orders"] },
      { to: "/suppliers", label: "مشتريات الموردين", icon: Truck, sections: ["suppliers"] },
      { to: "/supplier-accounts", label: "كشف حساب الموردين", icon: ClipboardList, sections: ["supplierAccounts"] },
    ],
  },
  {
    group: "العاملين والمرتبات",
    icon: Users,
    items: [
      { to: "/staff", label: "شؤون العاملين والعقود", icon: IdCard, sections: ["hr"] },
      { to: "/payroll", label: "الأجور والمرتبات", icon: Users, sections: ["payroll"] },
      { to: "/advances", label: "سُلف العاملين", icon: Banknote, sections: ["payroll"] },
    ],
  },
  {
    group: "المخازن والأجهزة",
    icon: Pill,
    items: [
      { to: "/stock", label: "المخزن العام", icon: Pill, sections: ["stock"] },
      { to: "/devices", label: "الأجهزة الطبية والصيانة", icon: Wrench, sections: ["devices"] },
      { to: "/inventory", label: "الأصول الثابتة والإهلاك", icon: Boxes, sections: ["inventory"] },
    ],
  },
  {
    group: "التقارير والأرباح",
    icon: BarChart3,
    items: [
      { to: "/revenues-expenses", label: "الإيرادات والمصروفات بالتفصيل", icon: Scale, sections: ["accounting", "expenses"] },
      { to: "/revenue-reports", label: "تقارير الإيرادات", icon: BarChart3, sections: ["reports"] },
      { to: "/payment-reports", label: "تقارير المدفوعات", icon: ReceiptText, sections: ["reports"] },
      { to: "/petty-reports", label: "تقارير النثريات", icon: HandHelping, sections: ["reports"] },
      { to: "/profits", label: "أرباح المستشفى", icon: Gem, sections: ["reports"] },
      { to: "/cost-centers", label: "مراكز التكلفة والربحية", icon: PieChart, sections: ["costCenters"] },
    ],
  },
  {
    group: "الحسابات العامة والإقفال",
    icon: BookOpen,
    items: [
      { to: "/financial-reports", label: "القوائم المالية ودفتر الأستاذ", icon: BookOpen, sections: ["accounting"] },
      { to: "/journal", label: "القيود اليدوية ودليل الحسابات", icon: NotebookPen, sections: ["accounting"] },
      { to: "/budget", label: "الموازنة التقديرية للأقسام", icon: Target, sections: ["costCenters"] },
      { to: "/fiscal-budget", label: "ميزانية السنة المالية", icon: CalendarRange, sections: ["costCenters"] },
      { to: "/closing", label: "التقفيل الشهري والسنوي", icon: CalendarCheck2, sections: ["closing"] },
    ],
  },
  {
    group: "الرقابة والإعدادات",
    icon: ShieldCheck,
    items: [
      { to: "/review", label: "المراجعة والاعتمادات", icon: FileSearch, sections: ["review", "approvals"] },
      { to: "/control", label: "الرقابة ومنع التلاعب", icon: ShieldAlert, sections: ["approvals"] },
      { to: "/permissions", label: "صلاحيات المستخدمين", icon: ShieldCheck, sections: ["system"] },
      { to: "/settings", label: "الإعدادات والنسخ الاحتياطي", icon: Settings, sections: ["settings"] },
    ],
  },
];

const isActive = (to: string, pathname: string) =>
  to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);

const visible = (me: PermActor, item: NavItem) => item.sections.some((s) => can(me, s, "view"));

function allowedItems(me: PermActor) {
  return NAV.flatMap((g) => g.items.filter((i) => visible(me, i)));
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-6">
      <div className="brand-mark grid size-11 shrink-0 place-items-center rounded-2xl text-primary-foreground">
        <HeartPulse className="size-6" />
      </div>
      <div className="min-w-0">
        <p className="font-display text-lg leading-tight font-bold text-sidebar-accent-foreground">
          {HOSPITAL.name}
        </p>
        <p className="truncate text-[11px] text-sidebar-foreground/70">{HOSPITAL.owner}</p>
      </div>
    </div>
  );
}

const OPEN_KEY = "alrahma-nav-open";

function NavList({
  me,
  onNavigate,
  badges,
}: {
  me: PermActor;
  onNavigate?: (() => void) | undefined;
  badges?: Partial<Record<NavPath, number>>;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [query, setQuery] = useState("");
  // Groups the person opened by hand; the current page's group is always open.
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "[]") as unknown;
      if (Array.isArray(saved)) setOpened(saved.filter((x): x is string => typeof x === "string"));
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = (group: string) =>
    setOpened((prev) => {
      const next = prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group];
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const q = query.trim();
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => visible(me, i) && (!q || i.label.includes(q) || g.group.includes(q))),
  })).filter((g) => g.items.length > 0);
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <nav className="flex flex-1 flex-col overflow-hidden">
      {allowedItems(me).length > 8 && (
        <div className="px-4 pb-3">
          <label className="nav-search">
            <Search className="size-4 shrink-0 opacity-60" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن صفحة…"
              aria-label="ابحث عن صفحة في القائمة"
              className="w-full bg-transparent text-sm outline-none placeholder:text-sidebar-foreground/45"
            />
          </label>
        </div>
      )}
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
        {groups.map((g) => {
          const hasActive = g.items.some((i) => isActive(i.to, pathname));
          const single = g.items.length === 1 && !q;
          const open = !!q || hasActive || opened.includes(g.group) || single;
          const badge = g.items.reduce((s, i) => s + (badges?.[i.to] ?? 0), 0);
          const GroupIcon = g.icon;
          return (
            <div key={g.group}>
              {!single && (
                <button
                  type="button"
                  onClick={() => toggle(g.group)}
                  aria-expanded={open}
                  className={cn("nav-group", hasActive && "nav-group-current")}
                >
                  <GroupIcon className="size-4 shrink-0 opacity-70" />
                  <span className="flex-1 text-right">{g.group}</span>
                  {!open && !!badge && <span className="nav-badge num">{badge}</span>}
                  <ChevronDown className={cn("size-4 shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
                </button>
              )}
              {open && (
                <ul className={cn("space-y-0.5", !single && "mb-2 mt-0.5")}>
                  {g.items.map((item) => {
                    const active = isActive(item.to, pathname);
                    const Icon = item.icon;
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onClick={onNavigate}
                          className={cn(
                            "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                            !single && "ps-5",
                            active
                              ? "nav-active font-semibold text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "h-5 w-1 rounded-full transition-colors",
                              active ? "bg-sidebar-primary" : "bg-transparent",
                            )}
                          />
                          <Icon className={cn("size-4.5 shrink-0", active && "text-sidebar-primary")} />
                          <span className="flex-1">{item.label}</span>
                          {!!badges?.[item.to] && (
                            <span className="nav-badge num" aria-label={`${badges[item.to]} طلب بانتظار اعتمادك`}>
                              {badges[item.to]}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        {!total && <p className="px-3 py-6 text-center text-xs text-sidebar-foreground/60">لا توجد صفحة بهذا الاسم.</p>}
      </div>
    </nav>
  );
}

function SidebarBody({
  onNavigate,
  onSignOut,
}: {
  onNavigate?: (() => void) | undefined;
  onSignOut: () => void;
}) {
  const { me, db } = useHospitalSession();
  if (!me) return null;
  return (
    <div className="sidebar-glow flex h-full flex-col text-sidebar-foreground">
      <Brand />
      <div className="mx-5 mb-5 h-px bg-sidebar-border" />
      <NavList me={me} onNavigate={onNavigate} badges={{ "/review": approvableCount(db, me) }} />
      <div className="border-t border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent font-bold text-sidebar-accent-foreground">
            {me.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
              {me.name}
            </p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              {ROLE_LABELS[me.role]}
              {me.boxId ? ` • ${findBox(db, me.boxId).name}` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
            onClick={onSignOut}
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut />
          </Button>
        </div>
        <p className="mt-3 text-[10px] text-sidebar-foreground/50">
          كل عملية تُحفظ على الجهاز أولًا ثم سيرفر المستشفى — لا يضيع شيء حتى لو انقطعت الشبكة
        </p>
      </div>
    </div>
  );
}

/** Offers the owner to upload records saved by the older device-only version. */
function LegacyImport() {
  const { me, db } = useHospitalSession();
  const [legacy, setLegacy] = useState<ReturnType<typeof readLegacyDeviceData>>(null);
  useEffect(() => {
    const l = readLegacyDeviceData();
    setLegacy(l && hasRecords(l) ? l : null);
  }, []);
  if (me?.role !== "admin" || !legacy || hasRecords(db)) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
      <CloudUpload className="size-6 shrink-0 text-primary" />
      <p className="flex-1 text-sm">
        وجدنا بيانات محفوظة على هذا الجهاز من النسخة السابقة ({legacy.patientInvoices.length}{" "}
        فاتورة، {legacy.transactions.length} حركة خزينة). هل تريد رفعها للسيرفر؟
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            if (restoreBackup(JSON.stringify(legacy))) {
              forgetLegacyDeviceData();
              setLegacy(null);
              toast.success("تم رفع بيانات الجهاز إلى السيرفر.");
            }
          }}
        >
          رفع البيانات
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            forgetLegacyDeviceData();
            setLegacy(null);
          }}
        >
          تجاهل
        </Button>
      </div>
    </div>
  );
}

/** Cloud save state: saved / saving N / waiting for the internet (changes kept on this device). */
function SyncBadge({ compact = false }: { compact?: boolean }) {
  const { state, queued } = useSyncStatus();
  const label =
    state === "offline"
      ? `بانتظار الاتصال بالسيرفر${queued ? ` • ${queued} محفوظة على الجهاز` : ""}`
      : state === "saving"
        ? `جارٍ الحفظ${queued > 1 ? ` (${queued})` : ""}`
        : "تم الحفظ على السيرفر";
  const Icon = state === "offline" ? CloudOff : state === "saving" ? RefreshCw : Cloud;
  return (
    <span
      role="status"
      aria-live="polite"
      title={label}
      className={cn(
        "sync-badge",
        state === "offline" && "sync-badge-offline",
        state === "saving" && "sync-badge-busy",
      )}
    >
      <Icon className={cn("size-3.5", state === "saving" && "animate-spin")} />
      {!compact && <span>{label}</span>}
    </span>
  );
}

/** Warns the director when backups stopped, failed, or the database was recovered from a backup. */
function BackupHealthAlert() {
  const [problem, setProblem] = useState<string | null>(null);
  const [action, setAction] = useState<"ack" | "backup" | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback(() => {
    void getBackupInfo()
      .then((i) => {
        if (!i.appMode) return;
        const week = Date.now() - 7 * 86400000;
        const rec = i.recoveries.find((r) => !r.acknowledgedAt && Date.parse(r.at) > week);
        const stale = !i.lastAt || Date.now() - Date.parse(i.lastAt) > 26 * 3600 * 1000;
        if (i.runningFromTemp) {
          setAction(null);
          setProblem(
            "البرنامج مفتوح من جوه الملف المضغوط، فأي حاجة تتسجل هتضيع لما تقفله. اقفل البرنامج، اعمل «فك الضغط» (Extract All) للفولدر على الفلاشة أو الهارد، وشغّله من هناك.",
          );
        } else if (rec) {
          setAction("ack");
          setProblem(
            rec.reason === "damaged-no-backup"
              ? "ملف البيانات فيه مشكلة ومفيش نسخة سليمة — افتح النسخ الاحتياطي فورًا."
              : rec.reason === "missing"
                ? "البرنامج اتفتح من غير ملف بيانات، فرجّع بياناتك تلقائيًا من آخر نسخة احتياطية — راجع آخر الحركات واضغط «تمام، راجعت»."
                : "ملف البيانات كان فيه مشكلة، فالنظام رجّع آخر نسخة احتياطية سليمة — راجع آخر الحركات واضغط «تمام، راجعت».",
          );
        } else if (stale && !i.running) {
          setAction("backup");
          setProblem(
            i.lastError
              ? `النسخ الاحتياطي مش بيكمل (${i.lastError}) — تأكد إن الفلاشة متوصلة واضغط «نسخ الآن».`
              : "مفيش نسخة احتياطية من أكتر من يوم — تأكد إن الفلاشة متوصلة واضغط «نسخ الآن».",
          );
        } else if (i.destinations.some((d) => d.lastError)) {
          setAction("backup");
          setProblem("النسخ الاحتياطي فشل في مكان من الأماكن — اضغط «نسخ الآن» أو افتح الإعدادات وشوف التفاصيل.");
        } else {
          setAction(null);
          setProblem(null);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    check();
    // The start-up backup finishes a few seconds after the app opens; look again so the warning clears on its own.
    const soon = setTimeout(check, 20_000);
    const every = setInterval(check, 10 * 60_000);
    // Settings → backup tells us when a backup ran or a recovery was reviewed, so the warning updates at once.
    window.addEventListener(BACKUP_CHANGED, check);
    return () => {
      clearTimeout(soon);
      clearInterval(every);
      window.removeEventListener(BACKUP_CHANGED, check);
    };
  }, [check]);
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(check, [path, check]);
  const acknowledge = () => {
    setBusy(true);
    void acknowledgeRecovery()
      .then(() => {
        toast.success("تمام — الرسالة دي مش هتظهر تاني.");
        setProblem(null);
        window.dispatchEvent(new Event(BACKUP_CHANGED));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر الحفظ."))
      .finally(() => setBusy(false));
  };
  const backup = () => {
    setBusy(true);
    void backupNow()
      .then((r) => {
        if (r.failed.length) toast.warning(`اتحفظت في ${r.saved} مكان، وفشلت في ${r.failed.length}: ${r.failed[0]?.error ?? ""}`);
        else toast.success(`تم النسخ الاحتياطي في ${r.saved} مكان.`);
        window.dispatchEvent(new Event(BACKUP_CHANGED));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "تعذّر النسخ الاحتياطي."))
      .finally(() => setBusy(false));
  };
  if (!problem) return null;
  return (
    <div className="mb-6 flex w-full flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
      <HardDriveDownload className="size-4 shrink-0" />
      <span className="flex-1">{problem}</span>
      <Link to="/settings" className="text-xs font-semibold underline-offset-2 hover:underline">
        الإعدادات ← النسخ الاحتياطي
      </Link>
      {action === "ack" && (
        <Button size="sm" variant="outline" onClick={acknowledge} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} تمام، راجعت
        </Button>
      )}
      {action === "backup" && (
        <Button size="sm" variant="outline" onClick={backup} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <HardDriveDownload />} نسخ الآن
        </Button>
      )}
    </div>
  );
}

/** Tells an approver (the finance manager) that requests are waiting, and when a new one arrives. */
function ApprovalAlert({ onOpen }: { onOpen: () => void }) {
  const { me, db } = useHospitalSession();
  const count = me ? approvableCount(db, me) : 0;
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (last.current !== null && count > last.current)
      toast.info("وصل طلب جديد بانتظار اعتمادك", {
        action: { label: "فتح الإشعارات", onClick: onOpen },
      });
    last.current = count;
  }, [count, onOpen]);
  if (!count) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-6 flex w-full items-center gap-2 rounded-lg border border-copper/40 bg-copper/10 px-4 py-2.5 text-right text-sm hover:bg-copper/15"
    >
      <ShieldCheck className="size-4 shrink-0 text-copper" />
      <span className="flex-1">
        عندك <b className="num">{count}</b> طلب بانتظار اعتمادك (صرف، نثريات، طلبيات، مخزن، إيصالات، حذف ملفات).
      </span>
      <span className="text-xs font-semibold text-primary">فتح الإشعارات</span>
    </button>
  );
}

export function AppShell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const openNotifications = useCallback(() => setNotifOpen(true), []);
  const { me } = useHospitalSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!me) return null;
  const allowed = allowedItems(me);
  const current = allowed.find((i) => isActive(i.to, pathname));
  if (!current) {
    if (!allowed.length)
      return (
        <div className="grid min-h-screen place-items-center px-4 text-center">
          <div>
            <p className="font-semibold">لم يحدد لك مدير المستشفى أي قسم بعد.</p>
            <Button className="mt-4" variant="outline" onClick={onSignOut}>
              <LogOut /> تسجيل الخروج
            </Button>
          </div>
        </div>
      );
    return <Navigate to={allowed[0]!.to} replace />;
  }
  const readOnly = !current.sections.some((s) => can(me, s, "add"));
  const addOnly = !readOnly && !current.sections.some((s) => can(me, s, "edit"));

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 lg:block">
        <SidebarBody onSignOut={onSignOut} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-sidebar px-4 py-3 text-sidebar-foreground lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="فتح القائمة"
            onClick={() => setOpen(true)}
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Menu />
          </Button>
          <HeartPulse className="size-5 text-sidebar-primary" />
          <span className="flex-1 truncate font-display font-bold text-sidebar-accent-foreground">
            {HOSPITAL.name}
          </span>
          <ServerAddress compact className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
          <SyncBadge compact />
          <NotificationsBell
            onOpen={openNotifications}
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          />
        </header>
        <div className="topbar sticky top-0 z-30 hidden items-center gap-3 px-10 py-3 lg:flex">
          <span className="stat-icon size-8 text-primary">
            <current.icon className="size-4" />
          </span>
          <span className="flex-1 truncate text-sm font-semibold text-foreground">{current.label}</span>
          <ServerAddress />
          <SyncBadge />
          <span className="h-5 w-px bg-border" />
          <span className="text-xs font-medium text-muted-foreground">{me.name}</span>
          <NotificationsBell onOpen={openNotifications} />
        </div>
        <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="w-72 border-0 p-0">
            <SheetTitle className="sr-only">القائمة الرئيسية</SheetTitle>
            <SidebarBody onNavigate={() => setOpen(false)} onSignOut={onSignOut} />
          </SheetContent>
        </Sheet>

        <main key={pathname} className="fade-up flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <LegacyImport />
          {pathname !== "/review" && <ApprovalAlert onOpen={openNotifications} />}
          {me.role === "admin" && pathname !== "/settings" && <BackupHealthAlert />}
          {readOnly && (
            <div className="mb-6 flex items-center gap-2 rounded-lg border border-copper/40 bg-copper/10 px-4 py-2.5 text-sm">
              <Eye className="size-4 shrink-0 text-copper" />
              صلاحيتك على هذا القسم: عرض فقط — أي تعديل سيتم رفضه.
            </div>
          )}
          {addOnly && (
            <div className="mb-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
              <Eye className="size-4 shrink-0 text-primary" />
              صلاحيتك على هذا القسم: عرض وإضافة — يمكنك تسجيل الجديد فقط، والتعديل أو الحذف سيتم رفضه.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
