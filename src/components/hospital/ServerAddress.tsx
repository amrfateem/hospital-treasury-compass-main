import { useEffect, useState } from "react";
import { Check, Copy, Globe2, Info } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Addresses {
  host: string;
  port: number;
  urls: string[];
}

/**
 * Shows the address staff type on other PCs (http://alrahma.local) with a copy button.
 * `http://` pages are not secure contexts, so navigator.clipboard may be missing —
 * fall back to the textarea + execCommand path for older WebView2/Edge installs.
 */
async function copyText(text: string) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function ServerAddress({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const [addresses, setAddresses] = useState<Addresses | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/addresses")
      .then((r) => (r.ok ? (r.json() as Promise<Addresses>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (alive && data.urls?.length) setAddresses(data);
        else if (alive) setAddresses(null);
      })
      .catch(() => {
        if (alive)
          setAddresses({ host: window.location.hostname, port: 0, urls: [window.location.origin] });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const primary =
    addresses?.urls[0] ??
    (typeof window === "undefined" ? "http://alrahma.local" : window.location.origin);
  const label = primary.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const copy = async (url: string) => {
    if (await copyText(url)) {
      setCopied(url);
      toast.success("تم نسخ الرابط");
    } else {
      toast.error("تعذر النسخ تلقائيًا", { description: `حدد الرابط وانسخه يدويًا: ${url}` });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className={cn("gap-1.5 text-muted-foreground hover:text-foreground", className)}
          aria-label="رابط الدخول من الأجهزة الأخرى"
          title="رابط الدخول من الأجهزة الأخرى"
        >
          <Globe2 className="size-4" />
          {!compact && <span className="text-xs font-semibold" dir="ltr">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">الدخول من الأجهزة الأخرى</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            افتح أحد هذه الروابط من متصفح أي جهاز على نفس الشبكة، ثم سجّل الدخول بحسابك.
          </p>
        </div>
        <ul className="max-h-64 overflow-y-auto p-2">
          {(addresses?.urls ?? [primary]).map((url, index) => (
            <li key={url}>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted-foreground">
                    {index === 0 ? "الاسم الثابت" : "عنوان الشبكة"}
                  </p>
                  <code dir="ltr" className="block truncate text-xs font-semibold">
                    {url}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={`نسخ ${url}`}
                  onClick={() => copy(url)}
                >
                  {copied === url ? <Check className="text-primary" /> : <Copy />}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-2 border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            لو لم يفتح الاسم على جهاز، استخدم عنوان الشبكة. لا بد أن يكون الجهاز على نفس شبكة السيرفر.
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
