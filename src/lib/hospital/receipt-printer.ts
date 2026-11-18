/**
 * Receipt-printer preferences belong to the device (the printer is plugged into this
 * reception PC), so they are kept in this browser, not in the shared hospital data.
 */
import { useCallback, useEffect, useState } from "react";
import type { PaperWidth } from "./thermal-receipt";

export interface ReceiptPrinterPrefs {
  width: PaperWidth;
  copies: number;
  /** Print on the receipt printer right after a new receipt is saved. */
  autoPrint: boolean;
  /** Windows printer chosen on this device for direct (silent) printing. */
  printer: string;
  /** Use the native silent printer command when the desktop shell provides it. */
  silent: boolean;
}

const KEY = "hospital.receiptPrinter.v1";
export const DEFAULT_PRINTER: ReceiptPrinterPrefs = {
  width: 80,
  copies: 1,
  autoPrint: true,
  printer: "",
  silent: true,
};

function read(): ReceiptPrinterPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PRINTER;
    const p = JSON.parse(raw) as Partial<ReceiptPrinterPrefs>;
    return {
      width: p.width === 58 ? 58 : 80,
      copies: Math.min(3, Math.max(1, Number(p.copies) || 1)),
      autoPrint: p.autoPrint ?? DEFAULT_PRINTER.autoPrint,
      printer: typeof p.printer === "string" ? p.printer : "",
      silent: p.silent ?? DEFAULT_PRINTER.silent,
    };
  } catch {
    return DEFAULT_PRINTER;
  }
}

export function useReceiptPrinter() {
  const [prefs, setPrefs] = useState<ReceiptPrinterPrefs>(DEFAULT_PRINTER);
  useEffect(() => setPrefs(read()), []);
  const update = useCallback((patch: Partial<ReceiptPrinterPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private mode — keep for this session only */
      }
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
