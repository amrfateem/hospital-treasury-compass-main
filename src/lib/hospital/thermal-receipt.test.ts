import { describe, expect, it } from "vitest";
import { emptyDB, type PatientInvoice } from "./model";
import { thermalReceiptHtml } from "./thermal-receipt";

const inv: PatientInvoice = {
  id: "i1",
  number: "INV-0007",
  date: "2026-11-15",
  patientName: "أحمد <علي>",
  department: "lab",
  items: [
    { description: "صورة دم كاملة", qty: 1, unitPrice: 120 },
    { description: "سكر تراكمي", qty: 1, unitPrice: 200 },
  ],
  discount: 20,
  paymentMethod: "cash",
  createdAt: Date.UTC(2026, 10, 15, 10, 30),
  payer: { payerId: "p1", percent: 50 },
};

function db() {
  const d = emptyDB();
  d.lists.payers = [{ id: "p1", name: "نقابة المهندسين", percent: 50 }];
  return d;
}

describe("thermal receipt", () => {
  it("sets the page to the chosen roll width (80 / 58 mm)", () => {
    expect(thermalReceiptHtml(db(), inv, { width: 80, copies: 1 })).toContain("size: 80mm auto");
    expect(thermalReceiptHtml(db(), inv, { width: 58, copies: 1 })).toContain("size: 58mm auto");
  });

  it("prints the patient's share after discount and insurer split", () => {
    // 320 - 20 discount = 300 net; insurer pays 50% → patient pays 150
    const html = thermalReceiptHtml(db(), inv, { width: 80, copies: 1 });
    expect(html).toContain("١٥٠٫٠٠ ج.م");
    expect(html).toContain("نصيب نقابة المهندسين");
  });

  it("repeats the slip for each copy and marks reprints", () => {
    const html = thermalReceiptHtml(db(), inv, { width: 80, copies: 2, reprint: true });
    expect(html.match(/class="slip"/g)).toHaveLength(2);
    expect(html).toContain("نسخة مكررة");
    expect(thermalReceiptHtml(db(), inv, { width: 80, copies: 1 })).not.toContain("نسخة مكررة");
  });

  it("escapes patient text so it cannot break the page", () => {
    const html = thermalReceiptHtml(db(), inv, { width: 80, copies: 1 });
    expect(html).toContain("أحمد &lt;علي&gt;");
    expect(html).not.toContain("<علي>");
  });
});
