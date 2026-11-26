import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  HardDriveDownload,
  Landmark,
  ListChecks,
  RotateCcw,
  Save,
  ShieldAlert,
  UserCog,
  Vault,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/hospital/ui";
import { DepartmentsManager } from "@/components/hospital/settings/DepartmentsManager";
import { ListsManager } from "@/components/hospital/settings/ListsManager";
import { ResetPanel } from "@/components/hospital/settings/ResetPanel";
import { UsersManager } from "@/components/hospital/settings/UsersManager";
import { CashboxesManager } from "@/components/hospital/settings/CashboxesManager";
import { BranchesCurrencies } from "@/components/hospital/settings/BranchesCurrencies";
import { BackupPanel } from "@/components/hospital/settings/BackupPanel";
import { LegacyImportPanel } from "@/components/hospital/settings/LegacyImportPanel";
import { DEFAULT_PAYROLL_SETTINGS } from "@/lib/hospital/payroll-tax";
import {
  saveSettings,
  useHospitalDB,
  useHospitalSession,
  type HospitalSettings,
} from "@/lib/hospital/store";

const TABS = ["users", "departments", "lists", "boxes", "branches", "hospital", "tax", "backup", "reset"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(s["tab"] as Tab) ? { tab: s["tab"] as Tab } : {},
  head: () => ({
    meta: [
      { title: "الإعدادات والمستخدمين والأقسام | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content:
          "إدارة أقسام الهيكل الوظيفي وقوائم الخدمات والأسعار وبيانات الترويسة ونسب التأمينات وتصفير النظام.",
      },
      { property: "og:title", content: "الإعدادات | مستشفى الرحمة التخصصي" },
      {
        property: "og:description",
        content: "الأقسام والبنود القابلة للتعديل وبيانات المستشفى ونسب الضرائب.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { me } = useHospitalSession();
  const owner = me?.role === "admin";
  const search = Route.useSearch();
  const tab =
    (search.tab === "users" || search.tab === "backup") && !owner
      ? "departments"
      : (search.tab ?? (owner ? "users" : "departments"));
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="لوحة الإعدادات"
        title="الإعدادات والمستخدمين"
        description="كل ما تضيفه أو تعدّله هنا يظهر فورًا في الفواتير والأجور والخزينة والتقارير."
      />
      <Tabs
        dir="rtl"
        value={tab}
        onValueChange={(v) => navigate({ search: { tab: v as Tab }, replace: true })}
      >
        <TabsList className="mb-6 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-muted p-1">
          {owner && (
            <TabsTrigger value="users" className="flex-none gap-1.5">
              <UserCog className="size-4" /> المستخدمين والصلاحيات
            </TabsTrigger>
          )}
          {owner && (
            <TabsTrigger value="backup" className="flex-none gap-1.5">
              <HardDriveDownload className="size-4" /> النسخ الاحتياطي
            </TabsTrigger>
          )}
          <TabsTrigger value="departments" className="flex-none gap-1.5">
            <Building2 className="size-4" /> الأقسام
          </TabsTrigger>
          <TabsTrigger value="lists" className="flex-none gap-1.5">
            <ListChecks className="size-4" /> البنود والقوائم
          </TabsTrigger>
          <TabsTrigger value="boxes" className="flex-none gap-1.5">
            <Vault className="size-4" /> الخزينة والبنوك
          </TabsTrigger>
          <TabsTrigger value="branches" className="flex-none gap-1.5">
            <Building2 className="size-4" /> الفروع والعملات
          </TabsTrigger>
          <TabsTrigger value="hospital" className="flex-none gap-1.5">
            <Landmark className="size-4" /> بيانات المستشفى
          </TabsTrigger>
          <TabsTrigger value="tax" className="flex-none gap-1.5">
            <Save className="size-4" /> التأمينات والضرائب
          </TabsTrigger>
          <TabsTrigger value="reset" className="flex-none gap-1.5">
            <ShieldAlert className="size-4" /> النسخ والتصفير
          </TabsTrigger>
        </TabsList>
        {owner && (
          <TabsContent value="users">
            <UsersManager />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="backup">
            <div className="grid gap-4">
              <BackupPanel />
              <LegacyImportPanel />
            </div>
          </TabsContent>
        )}
        <TabsContent value="boxes">
          <CashboxesManager />
        </TabsContent>
        <TabsContent value="branches">
          <BranchesCurrencies />
        </TabsContent>
        <TabsContent value="departments">
          <DepartmentsManager />
        </TabsContent>
        <TabsContent value="lists">
          <ListsManager />
        </TabsContent>
        <TabsContent value="hospital">
          <SettingsForm section="hospital" />
        </TabsContent>
        <TabsContent value="tax">
          <SettingsForm section="tax" />
        </TabsContent>
        <TabsContent value="reset">
          <ResetPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SettingsForm({ section }: { section: "hospital" | "tax" }) {
  const db = useHospitalDB();
  const [s, setS] = useState<HospitalSettings>(db.settings);
  useEffect(() => setS(db.settings), [db.settings]);

  const text = (k: keyof HospitalSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [k]: e.target.value });
  const num =
    (k: keyof HospitalSettings, factor = 1) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setS({ ...s, [k]: (Number(e.target.value) || 0) / factor });

  return (
    <form
      className="max-w-4xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        saveSettings(s);
        toast.success("تم حفظ الإعدادات.");
      }}
    >
      {section === "hospital" ? (
        <section className="ledger-card grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h2 className="text-xl font-bold">بيانات الترويسة</h2>
            <p className="text-sm text-muted-foreground">تظهر أعلى كل مستند PDF رسمي.</p>
          </div>
          <Field id="address" label="العنوان" className="sm:col-span-2">
            <Input
              id="address"
              value={s.address}
              onChange={text("address")}
              placeholder="مثال: ش الجمهورية — المنصورة"
            />
          </Field>
          <Field id="phones" label="أرقام التليفون">
            <Input id="phones" value={s.phones} onChange={text("phones")} />
          </Field>
          <Field id="taxId" label="رقم التسجيل الضريبي">
            <Input id="taxId" value={s.taxId} onChange={text("taxId")} />
          </Field>
          <Field id="cr" label="رقم السجل التجاري">
            <Input id="cr" value={s.commercialRegister} onChange={text("commercialRegister")} />
          </Field>
        </section>
      ) : (
        <section className="ledger-card grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h2 className="text-xl font-bold">التأمينات وضريبة كسب العمل</h2>
            <p className="text-sm text-muted-foreground">
              حدّث الحد الأدنى والأقصى لأجر الاشتراك مع كل سنة جديدة.
            </p>
          </div>
          <Field id="siEmp" label="حصة العامل في التأمينات (٪)">
            <Input
              id="siEmp"
              type="number"
              step="0.01"
              value={+(s.siEmployeeRate * 100).toFixed(4)}
              onChange={num("siEmployeeRate", 100)}
            />
          </Field>
          <Field id="siEr" label="حصة صاحب العمل (٪)">
            <Input
              id="siEr"
              type="number"
              step="0.01"
              value={+(s.siEmployerRate * 100).toFixed(4)}
              onChange={num("siEmployerRate", 100)}
            />
          </Field>
          <Field id="siMin" label="الحد الأدنى لأجر الاشتراك (شهري)">
            <Input id="siMin" type="number" value={s.siMinWage} onChange={num("siMinWage")} />
          </Field>
          <Field id="siMax" label="الحد الأقصى لأجر الاشتراك (شهري)">
            <Input id="siMax" type="number" value={s.siMaxWage} onChange={num("siMaxWage")} />
          </Field>
          <Field id="exempt" label="الإعفاء الشخصي السنوي">
            <Input
              id="exempt"
              type="number"
              value={s.personalExemption}
              onChange={num("personalExemption")}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setS({ ...s, ...DEFAULT_PAYROLL_SETTINGS })}
            >
              <RotateCcw /> القيم الافتراضية
            </Button>
          </div>
        </section>
      )}
      <Button type="submit">
        <Save /> حفظ الإعدادات
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
