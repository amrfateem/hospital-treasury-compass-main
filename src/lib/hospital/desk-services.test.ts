import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES, findDeskService, servicesForDesk } from "./catalog";
import type { ServiceItem } from "./model";

const svc = (id: string, name: string, department?: string, extra: Partial<ServiceItem> = {}): ServiceItem => ({
  id,
  name,
  price: 100,
  department,
  kind: "procedure",
  ...extra,
});

describe("receipt shows only the chosen department's services", () => {
  it("lab receipt lists lab services only — no radiology, ER, clinics or ICU", () => {
    const { own } = servicesForDesk(DEFAULT_SERVICES, { department: "lab" });
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((s) => s.department === "lab")).toBe(true);
    expect(own.some((s) => s.name === "صورة دم كاملة CBC")).toBe(true);
    expect(own.some((s) => s.name === "أشعة صدر")).toBe(false);
  });

  it("shared (no-department) services are kept apart, not mixed into the department list", () => {
    const list = [svc("a", "CBC", "lab"), svc("b", "رسوم ملف", undefined), svc("c", "أشعة صدر", "radiology")];
    const r = servicesForDesk(list, { department: "lab" });
    expect(r.own.map((s) => s.id)).toEqual(["a"]);
    expect(r.shared.map((s) => s.id)).toEqual(["b"]);
  });

  it("clinics desk adds the chosen specialty clinic's services only", () => {
    const list = [svc("a", "كشف", "clinics"), svc("b", "رسم مخ", "neuro"), svc("c", "منظار", "gi")];
    expect(servicesForDesk(list, { department: "clinics", clinicDept: "neuro" }).own.map((s) => s.id)).toEqual(["a", "b"]);
    expect(servicesForDesk(list, { department: "clinics" }).own.map((s) => s.id)).toEqual(["a"]);
  });

  it("no department chosen yet shows nothing", () => {
    expect(servicesForDesk(DEFAULT_SERVICES, { department: null })).toEqual({ own: [], shared: [] });
  });

  it("ICU day rates are not listed as services (they are the stay fields)", () => {
    const { own } = servicesForDesk(DEFAULT_SERVICES, { department: "icu", stay: true });
    expect(own.some((s) => s.stay)).toBe(false);
  });

  it("a typed name takes the price of the section's own service, not a same-named one elsewhere", () => {
    const lab = [svc("a", "ECG", "lab", { price: 120 })];
    const shared = [svc("b", "ECG", undefined, { price: 999 })];
    expect(findDeskService("ECG", lab, shared)!.price).toBe(120);
    expect(findDeskService("ECG", [], shared)!.price).toBe(999);
    expect(findDeskService("غير موجود", lab, shared)).toBeUndefined();
  });
});
