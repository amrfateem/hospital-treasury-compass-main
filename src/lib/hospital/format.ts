const moneyFmt = new Intl.NumberFormat("ar-EG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const intFmt = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });
const monthFmt = new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" });
const monthOnlyFmt = new Intl.DateTimeFormat("ar-EG", { month: "long" });
const dateFmt = new Intl.DateTimeFormat("ar-EG", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const money = (n: number) => moneyFmt.format(n || 0);
export const egp = (n: number) => `${money(n)} ج.م`;
export const int = (n: number) => intFmt.format(n || 0);

export function periodOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function isoDate(date: Date) {
  return `${periodOf(date)}-${String(date.getDate()).padStart(2, "0")}`;
}
export function monthLabel(period: string) {
  const [y, m] = period.split("-").map(Number) as [number, number, number];
  return monthFmt.format(new Date(y, m - 1, 1));
}
export function monthName(month: number) {
  return monthOnlyFmt.format(new Date(2026, month - 1, 1));
}
export function dateLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return dateFmt.format(new Date(y, m - 1, d));
}
export function lastDayOfPeriod(period: string) {
  const [y, m] = period.split("-").map(Number) as [number, number, number];
  return isoDate(new Date(y, m, 0));
}

function plural(n: number, one: string, two: string, few: string, many: string) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${int(n)} ${few}`;
  return `${int(n)} ${many}`;
}

/** Work duration from hire date until the end of the given period, in Arabic. */
export function workDuration(hireDate: string, period: string) {
  const [hy, hm] = hireDate.split("-").map(Number) as [number, number, number];
  const [py, pm] = period.split("-").map(Number) as [number, number, number];
  const total = (py - hy) * 12 + (pm - hm) + 1;
  if (total <= 0) return "—";
  const years = Math.floor(total / 12);
  const months = total % 12;
  const parts: string[] = [];
  if (years) parts.push(plural(years, "سنة", "سنتان", "سنوات", "سنة"));
  if (months) parts.push(plural(months, "شهر", "شهران", "أشهر", "شهرًا"));
  return parts.join(" و");
}
