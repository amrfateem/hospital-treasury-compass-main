import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES } from "./catalog";
import { normalizeDB } from "./model";
import { DEFAULT_STOCK_ITEMS } from "./stock-catalog";

describe("ICU basics and consumables", () => {
  it("ICU receipt price list has devices, procedures, bedside checks and itemized consumables", () => {
    const icu = DEFAULT_SERVICES.filter((s) => s.department === "icu");
    const groups = new Set(icu.map((s) => s.group));
    for (const g of ["الإقامة اليومية", "الأجهزة (يوميًا)", "إجراءات العناية", "متابعة وفحوص بجوار السرير", "المستهلكات"])
      expect(groups.has(g)).toBe(true);
    expect(icu.filter((s) => s.group === "المستهلكات").length).toBeGreaterThanOrEqual(30);
    expect(icu.every((s) => s.price > 0)).toBe(true);
    expect(new Set(DEFAULT_SERVICES.map((s) => s.id)).size).toBe(DEFAULT_SERVICES.length);
    expect(new Set(icu.map((s) => s.name)).size).toBe(icu.length);
  });

  it("ICU store holds its own respiratory, nursing, drug and fluid items", () => {
    const icu = DEFAULT_STOCK_ITEMS.filter((i) => i.department === "icu");
    expect(new Set(icu.map((i) => i.category))).toEqual(new Set(["sc12", "sc2", "sc1", "sc7"]));
    expect(new Set(DEFAULT_STOCK_ITEMS.map((i) => i.id)).size).toBe(DEFAULT_STOCK_ITEMS.length);
    expect(new Set(icu.map((i) => i.name)).size).toBe(icu.length);
  });

  it("a system saved before this list receives the new ICU items once, keeping its own prices", () => {
    const older = normalizeDB({
      transactions: [],
      lists: { services: [{ id: "cat-icu-bed", name: "سرير عناية", price: 3000, department: "icu", stay: "room" }] } as never,
      stockItems: [],
      settings: { catalogVersion: 2, stockCatalogVersion: 1 } as never,
    });
    expect(older.lists.services.find((s) => s.id === "cat-icu-bed")!.price).toBe(3000);
    expect(older.lists.services.some((s) => s.id === "cat-icu-cvc-kit")).toBe(true);
    expect(older.stockItems.some((i) => i.id === "stk-icu-noradrenaline")).toBe(true);
    const removed = { ...older, lists: { ...older.lists, services: older.lists.services.filter((s) => s.id !== "cat-icu-cvc-kit") } };
    expect(normalizeDB(removed).lists.services.some((s) => s.id === "cat-icu-cvc-kit")).toBe(false);
  });
});
