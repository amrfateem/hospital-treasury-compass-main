import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { HeartPulse, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HOSPITAL } from "@/lib/hospital/constants";
import { USERNAME_RE, normalizeUsername } from "@/lib/hospital/staff";
import { createFirstAdmin, getSetupStatus } from "@/lib/hospital/users.functions";
import { getSession, signIn as createSession } from "@/lib/hospital/session.functions";
import { setCurrentUserId } from "@/lib/hospital/current-user";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s["redirect"] === "string" ? s["redirect"] : undefined,
  }),
  // No loader: the form shows at once (sign-in is the usual case) and the one-time
  // "create the first director" check runs in the background.
  head: () => ({
    meta: [
      { title: "تسجيل الدخول | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "دخول موظفي مستشفى الرحمة التخصصي إلى نظام الحسابات والخزينة.",
      },
      { property: "og:title", content: "تسجيل الدخول | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "نظام الحسابات والخزينة والفواتير — دخول الموظفين." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether the owner account still has to be created; null when the server can't be reached. */
async function setupStatusWithRetry(tries = 3): Promise<{ needsSetup: boolean | null }> {
  for (let i = 0; i < tries; i++) {
    try {
      return await getSetupStatus();
    } catch (e) {
      if (i === tries - 1) {
        console.warn("Setup status unavailable", e);
        return { needsSetup: null };
      }
      await wait(600 * (i + 1));
    }
  }
  return { needsSetup: null };
}

/** Only same-origin relative paths are followed after sign-in. */
function safeTarget(r: string | undefined) {
  if (!r) return "/";
  try {
    const u = new URL(r, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : "/";
  } catch {
    return "/";
  }
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [setup, setSetup] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let alive = true;
    void setupStatusWithRetry().then((r) => {
      if (!alive) return;
      setSetup(!!r.needsSetup);
      setOffline(r.needsSetup === null);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Keep trying quietly until the server answers.
  useEffect(() => {
    if (!offline) return;
    const t = setInterval(() => {
      void setupStatusWithRetry(1).then((r) => {
        if (r.needsSetup === null) return;
        setSetup(r.needsSetup);
        setOffline(false);
      });
    }, 4000);
    return () => clearInterval(t);
  }, [offline]);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getSession().then(({ user }) => {
      if (user) {
        setCurrentUserId(user.id);
        void navigate({ to: safeTarget(redirect), replace: true });
      }
    });
  }, [navigate, redirect]);

  async function signIn(u: string, p: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        const { user } = await createSession({ data: { username: u, password: p } });
        setCurrentUserId(user.id);
        break;
      } catch (err) {
        const network = err instanceof TypeError && /fetch/i.test(err.message);
        if (network && attempt < 2) {
          await wait(800 * (attempt + 1));
          continue;
        }
        if (network) throw new TypeError("fetch failed");
        throw err instanceof Error ? err : new Error("اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب موقوف.");
      }
    }
    await router.invalidate();
    void navigate({ to: safeTarget(redirect), replace: true });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const u = normalizeUsername(username);
    if (!u || !password) return setError("اكتب اسم المستخدم وكلمة المرور.");
    if (setup) {
      if (!USERNAME_RE.test(u))
        return setError("اسم المستخدم: حروف إنجليزية صغيرة وأرقام (٣ إلى ٣٠ حرفًا) بدون مسافات.");
      if (!fullName.trim()) return setError("اكتب اسمك بالكامل.");
      if (password.length < 8) return setError("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
      if (password !== confirm) return setError("كلمتا المرور غير متطابقتين.");
    }
    setBusy(true);
    try {
      if (setup) {
        await createFirstAdmin({ data: { username: u, fullName: fullName.trim(), password } });
        setSetup(false);
      }
      await signIn(u, password);
    } catch (err) {
      const network = err instanceof TypeError && /fetch/i.test(err.message);
      setError(
        network
          ? "تعذّر الاتصال بسيرفر المستشفى — تأكد من الشبكة وحاول مرة أخرى."
          : err instanceof Error
            ? err.message
            : "حدث خطأ، حاول مرة أخرى.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.1fr_1fr]">
      <aside className="sidebar-glow relative hidden flex-col justify-between p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg">
            <HeartPulse className="size-7" />
          </div>
          <div>
            <p className="font-display text-xl font-bold text-sidebar-accent-foreground">
              {HOSPITAL.name}
            </p>
            <p className="text-xs text-sidebar-foreground/70">{HOSPITAL.owner}</p>
          </div>
        </div>
        <div>
          <p className="font-display text-4xl leading-snug font-bold text-sidebar-accent-foreground">
            الحسابات والخزينة والفواتير
            <br />
            في مكان واحد لكل أقسام المستشفى
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-sidebar-foreground/75">
            كل موظف يدخل بحسابه ويرى ما يخصه فقط. البيانات محفوظة على سيرفر المستشفى وتظهر لحظيًا على
            كل أجهزة الشبكة.
          </p>
        </div>
        <p className="text-[11px] text-sidebar-foreground/50">
          نظام المحاسبة والضرائب وحركة الخزينة
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-10">
        <form onSubmit={submit} className="ledger-card w-full max-w-sm space-y-4 p-6">
          <div className="mb-2 flex items-center gap-2 lg:hidden">
            <HeartPulse className="size-6 text-primary" />
            <span className="font-display font-bold">{HOSPITAL.name}</span>
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">
              {setup ? "إعداد حساب المالك / مدير النظام" : "تسجيل الدخول"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {setup
                ? "أول حساب يُنشأ هنا هو المدير، ومنه تضيف حسابات الاستقبال والمدير المالي."
                : "ادخل باسم المستخدم وكلمة المرور التي أعطاها لك المدير."}
            </p>
          </div>
          {setup && (
            <div className="grid gap-1.5">
              <Label htmlFor="a-name">الاسم بالكامل</Label>
              <Input id="a-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="a-user">اسم المستخدم</Label>
            <Input
              id="a-user"
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              placeholder="مثال: sami"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-pass">كلمة المرور</Label>
            <Input
              id="a-pass"
              type="password"
              dir="ltr"
              autoComplete={setup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {setup && (
            <div className="grid gap-1.5">
              <Label htmlFor="a-pass2">تأكيد كلمة المرور</Label>
              <Input
                id="a-pass2"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
          {offline && (
            <p className="rounded-md border border-copper/40 bg-copper/10 px-3 py-2 text-xs">
              الاتصال بالسيرفر ضعيف دلوقتي — بنحاول تاني تلقائيًا. تقدر تكتب بياناتك وتضغط دخول.
            </p>
          )}
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : setup ? <ShieldCheck /> : <LogIn />}
            {setup ? "إنشاء حساب المدير والدخول" : "دخول"}
          </Button>
          {!setup && (
            <p className="text-center text-[11px] text-muted-foreground">
              نسيت كلمة المرور؟ اطلب من مدير النظام تعيين كلمة جديدة.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
