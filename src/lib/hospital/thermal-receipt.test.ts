import { describe, expect, it } from "vitest";
import { emptyDB, type PatientInvoice } from "./model";
import { pageRule, printableWidth, slipLeftMm, thermalReceiptHtml } from "./thermal-receipt";
import { dotsFor, trimRaster } from "./native-print";

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
  it("sizes the receipt body to the chosen roll width (80 / 58 mm)", () => {
    expect(thermalReceiptHtml(db(), inv, { width: 80, copies: 1 })).toContain("width: 80mm");
    expect(thermalReceiptHtml(db(), inv, { width: 58, copies: 1 })).toContain("width: 58mm");
    expect(thermalReceiptHtml(db(), inv, { width: 80, copies: 1 })).not.toContain("@page { size:");
  });

  it("lays the slip out at the printable width (72 mm on 80 mm rolls, 48 mm on 58 mm) and centres it", () => {
    expect(thermalReceiptHtml(db(), inv, { width: 80, copies: 1 })).toContain(".slip { width: 72mm; margin: 0 0 0 4mm;");
    expect(thermalReceiptHtml(db(), inv, { width: 58, copies: 1 })).toContain(".slip { width: 48mm; margin: 0 0 0 5mm;");
  });

  it("applies the device's own printable width and offset", () => {
    expect(printableWidth(80, 76)).toBe(76);
    expect(printableWidth(80, 95)).toBe(80);
    expect(slipLeftMm(80, 72, 2)).toBe(6);
    expect(slipLeftMm(80, 72, -9)).toBe(0);
    expect(thermalReceiptHtml(db(), inv, { width: 80, copies: 1, printableMm: 76, offsetMm: 1 })).toContain(".slip { width: 76mm; margin: 0 0 0 3mm;");
  });

  it("sends 576 dots for 72 mm and 384 dots for 48 mm to the printer head", () => {
    expect(dotsFor(72)).toBe(576);
    expect(dotsFor(48)).toBe(384);
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

  it("cuts the blank paper above and below the printed lines, keeping 1 mm on top and 2 mm below", () => {
    const widthBytes = 2;
    // 40 blank rows, 3 printed rows (one blank in between), 60 blank rows
    const height = 103;
    const packed = new Uint8Array(widthBytes * height);
    packed[40 * widthBytes] = 0xff;
    packed[42 * widthBytes + 1] = 0x01;
    const t = trimRaster(packed, widthBytes, height);
    expect(t.height).toBe(8 + 3 + 16);
    expect(t.data[8 * widthBytes]).toBe(0xff);
    expect(t.data[10 * widthBytes + 1]).toBe(0x01);
  });

  it("starts the print window at the top of the roll unless exact page size is chosen", () => {
    expect(pageRule("roll", 80, 150)).toBe("@page { margin: 0; }");
    expect(pageRule("exact", 80, 150.2)).toBe("@page { size: 80mm 151mm; margin: 0; }");
  });
});
