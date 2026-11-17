import { Link } from "@tanstack/react-router";
import { Bell, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { egp, int } from "@/lib/hospital/format";
import {
  KIND_LABELS,
  KIND_LINKS,
  myRequests,
  unseenDecisions,
  waitingForMe,
  type Notice,
} from "@/lib/hospital/notifications";
import { can, useHospitalSession } from "@/lib/hospital/store";
import { cn } from "@/lib/utils";
import { decideNotice } from "./decide";

/* ---------- "seen" marker per person on this device (decisions on my requests) ---------- */
const listeners = new Set<() => void>();
const seenKey = (userId: string) => `rahma-notifications-seen:${userId}`;
function readSeen(userId: string) {
  try {
    return Number(window.localStorage.getItem(seenKey(userId))) || 0;
  } catch {
    return 0;
  }
}
function markSeen(userId: string) {
  try {
    window.localStorage.setItem(seenKey(userId), String(Date.now()));
  } catch {
    /* private mode: badge just stays */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** What the bell shows: requests waiting for my decision + decisions on my requests I have not seen. */
export function useNotifications() {
  const { me, db } = useHospitalSession();
  const userId = me?.id ?? "";
  const seenAt = useSyncExternalStore(
    subscribe,
    () => (userId ? readSeen(userId) : Number.MAX_SAFE_INTEGER),
    () => Number.MAX_SAFE_INTEGER,
  );
  return useMemo(() => {
    if (!me) return { waiting: [], mine: { waiting: [], decided: [] }, unseen: 0, count: 0, seenAt };
    const waiting = waitingForMe(db, me);
    const mine = myRequests(db, me.id, Date.now());
    const unseen = unseenDecisions(mine.decided, seenAt);
    return { waiting, mine, unseen, count: waiting.length + unseen, seenAt };
  }, [db, me, seenAt]);
}

export function NotificationsBell({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { count, waiting } = useNotifications();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onOpen}
      aria-label={count ? `الإشعارات — ${count} جديد` : "الإشعارات"}
      title="الإشعارات"
      className={cn("relative", className)}
    >
      <Bell className={cn(waiting.length > 0 && "notif-ring")} />
      {count > 0 && <span className="notif-count num">{count > 99 ? "99+" : count}</span>}
    </Button>
  );
}

const rel = new Intl.RelativeTimeFormat("ar-EG", { numeric: "auto" });
function ago(ms: number) {
  const s = Math.round((ms - Date.now()) / 1000);
  if (s > -60) return "الآن";
  if (s > -3600) return rel.format(Math.round(s / 60), "minute");
  if (s > -86_400) return rel.format(Math.round(s / 3600), "hour");
  return rel.format(Math.round(s / 86_400), "day");
}

export function NotificationsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { me } = useHospitalSession();
  const { waiting, mine, seenAt } = useNotifications();
  const [seenWhenOpened, setSeenWhenOpened] = useState(0);
  if (!me) return null;
  const approver = can(me, "approvals", "edit") && (me.role === "finance" || me.role === "admin");

  function change(o: boolean) {
    if (o) setSeenWhenOpened(seenAt);
    else if (me) markSeen(me.id);
    onOpenChange(o);
  }

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4 text-right">
          <SheetTitle className="flex items-center gap-2 font-display text-xl">
            <Bell className="size-5 text-primary" /> الإشعارات
          </SheetTitle>
          <SheetDescription>
            {approver
              ? "الطلبات التي تحتاج اعتمادك — اعتمدها أو ارفضها من هنا مباشرة."
              : "متابعة طلباتك: ما زال بانتظار اعتماد المدير المالي وما تم البت فيه."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {approver && (
            <section aria-label="بانتظار اعتمادك">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
                بانتظار اعتمادك
                <span className="num rounded-full bg-copper px-2 text-[11px] text-copper-foreground">{int(waiting.length)}</span>
              </h3>
              {waiting.length ? (
                <ul className="grid gap-2">
                  {waiting.map((n) => (
                    <PendingCard key={n.key} n={n} />
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-1 size-6 text-income" />
                  لا توجد طلبات بانتظار اعتمادك.
                </p>
              )}
            </section>
          )}

          {(mine.decided.length > 0 || mine.waiting.length > 0 || !approver) && (
            <section aria-label="طلباتي">
              <h3 className="mb-2 text-sm font-bold">طلباتك</h3>
              <ul className="grid gap-2">
                {mine.decided.map((n) => (
                  <DecidedCard key={n.key} n={n} fresh={(n.decidedAt ?? 0) > seenWhenOpened} />
                ))}
                {mine.waiting.map((n) => (
                  <li key={n.key} className="notif-card">
                    <NoticeHead n={n} />
                    <p className="flex items-center gap-1 text-xs text-copper">
                      <Clock className="size-3.5" /> بانتظار اعتماد المدير المالي — {ago(n.at)}
                    </p>
                  </li>
                ))}
              </ul>
              {!mine.decided.length && !mine.waiting.length && (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">لا توجد إشعارات جديدة.</p>
              )}
            </section>
          )}
        </div>

        {can(me, "approvals", "view") && (
          <div className="border-t px-4 py-3">
            <Button variant="outline" className="w-full" asChild onClick={() => change(false)}>
              <Link to="/review">صفحة المراجعة والاعتمادات</Link>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NoticeHead({ n }: { n: Notice }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="notif-kind">{KIND_LABELS[n.kind]}</span>
        <span className="num font-mono text-[11px] text-muted-foreground" dir="ltr">
          {n.number}
        </span>
      </div>
      <p className="text-sm font-semibold leading-snug">{n.title}</p>
      <p className="text-xs text-muted-foreground">
        {n.detail} • طلبه {n.requestedBy}
      </p>
      {n.amount !== undefined && <p className="num text-base font-bold">{egp(n.amount)}</p>}
    </>
  );
}

function PendingCard({ n }: { n: Notice }) {
  const [mode, setMode] = useState<"idle" | "reject" | "confirm">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const takesNote = n.kind === "payment" || n.kind === "petty" || n.kind === "issue";

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const ok = await decideNotice(n, approve, note);
      if (ok) toast.success(approve ? `تم اعتماد ${KIND_LABELS[n.kind]} ${n.number}.` : `تم رفض ${KIND_LABELS[n.kind]} ${n.number}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="notif-card">
      <NoticeHead n={n} />
      <p className="text-[11px] text-muted-foreground">
        {ago(n.at)} —{" "}
        <Link to={KIND_LINKS[n.kind]} className="text-primary hover:underline">
          فتح الصفحة
        </Link>
      </p>
      {n.kind === "patientDelete" && (
        <p className="rounded bg-expense/10 px-2 py-1 text-[11px] text-expense">
          الموافقة تحذف الملف الطبي ومرفقاته نهائيًا، وتبقى إيصالاته المالية في السجلات.
        </p>
      )}
      {mode === "reject" ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void decide(false);
          }}
        >
          {takesNote && (
            <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب الرفض (اختياري)" aria-label="سبب الرفض" className="h-9" />
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <XCircle />} تأكيد الرفض
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
              رجوع
            </Button>
          </div>
        </form>
      ) : mode === "confirm" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void decide(true)}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} تأكيد حذف الملف نهائيًا
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
            رجوع
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => (n.kind === "patientDelete" ? setMode("confirm") : void decide(true))}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} اعتماد
          </Button>
          <Button size="sm" variant="outline" className="flex-1 text-destructive" disabled={busy} onClick={() => setMode("reject")}>
            <XCircle /> رفض
          </Button>
        </div>
      )}
    </li>
  );
}

function DecidedCard({ n, fresh }: { n: Notice; fresh: boolean }) {
  const ok = n.status === "approved";
  return (
    <li className={cn("notif-card", fresh && "notif-card-fresh")}>
      <NoticeHead n={n} />
      <p className={cn("flex items-center gap-1 text-xs font-semibold", ok ? "text-income" : "text-expense")}>
        {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
        {ok ? "تم الاعتماد" : "تم الرفض"}
        {n.decidedBy ? ` من ${n.decidedBy}` : ""} — {ago(n.decidedAt ?? n.at)}
      </p>
      {n.note && <p className="text-xs text-muted-foreground">السبب: {n.note}</p>}
    </li>
  );
}
