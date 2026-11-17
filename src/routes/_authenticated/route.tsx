import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { HeartPulse, Loader2, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/hospital/AppShell";
import { getSession, signOut as endSession } from "@/lib/hospital/session.functions";
import { setCurrentUserId } from "@/lib/hospital/current-user";
import {
  clearHospital,
  loadHospital,
  startLiveSync,
  unsentCount,
  useHospitalSession,
} from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // The session cookie is checked once per navigation; the server re-checks every request.
    const { user } = await getSession();
    if (!user) throw redirect({ to: "/auth", search: { redirect: location.href } });
    setCurrentUserId(user.id);
  },
  component: AuthedLayout,
});

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="max-w-sm text-center">{children}</div>
    </div>
  );
}

function AuthedLayout() {
  const session = useHospitalSession();
  const navigate = useNavigate();

  useEffect(() => {
    void loadHospital();
    return startLiveSync();
  }, []);

  async function signOut() {
    if (
      unsentCount() > 0 &&
      !window.confirm(
        "توجد تغييرات لم تصل للسيرفر بعد. ستبقى محفوظة على هذا الجهاز وتُرسل عند تسجيل دخولك مرة أخرى. هل تريد تسجيل الخروج؟",
      )
    )
      return;
    clearHospital();
    await endSession();
    void navigate({ to: "/auth", search: { redirect: undefined }, replace: true });
  }

  if (session.status === "no-access")
    return (
      <FullScreen>
        <ShieldAlert className="mx-auto size-10 text-destructive" />
        <h1 className="mt-3 font-display text-2xl font-bold">لا توجد صلاحية دخول</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          حسابك غير مفعّل أو لم يُحدَّد له دور. تواصل مع مدير النظام.
        </p>
        <Button className="mt-5" variant="outline" onClick={signOut}>
          <LogOut /> تسجيل الخروج
        </Button>
      </FullScreen>
    );

  if (session.status === "error")
    return (
      <FullScreen>
        <p className="font-semibold">تعذّر الاتصال بسيرفر المستشفى.</p>
        <p className="mt-1 text-sm text-muted-foreground">تأكد من تشغيل السيرفر والشبكة ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={() => void loadHospital()}>
          <RefreshCw /> إعادة المحاولة
        </Button>
      </FullScreen>
    );

  if (session.status !== "ready")
    return (
      <FullScreen>
        <HeartPulse className="mx-auto size-10 text-primary" />
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> جارٍ تحميل بيانات المستشفى...
        </p>
      </FullScreen>
    );

  return (
    <AppShell onSignOut={signOut}>
      <Outlet />
    </AppShell>
  );
}
