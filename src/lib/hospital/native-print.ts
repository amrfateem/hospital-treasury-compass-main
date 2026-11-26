/**
 * Direct receipt printing for the packaged desktop shell.
 * The receipt HTML is rendered once at the printer's dot width, converted to a 1-bit
 * ESC/POS raster and sent to the selected Windows printer, so no print dialog opens and
 * the driver never scales an A4 page onto the 80 mm roll.
 */
import { invoke } from "@tauri-apps/api/core";

interface TauriInternals {
  invoke?: unknown;
}

export function isNativePrint() {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window && !!(window as unknown as { __TAURI_INTERNALS__: TauriInternals });
}

export async function listPrinters(): Promise<string[]> {
  if (!isNativePrint()) return [];
  return invoke<string[]>("list_printers");
}

export async function defaultPrinter(): Promise<string> {
  if (!isNativePrint()) return "";
  return invoke<string>("default_printer");
}

export async function openExportsFolder(): Promise<void> {
  if (!isNativePrint()) return;
  await invoke("open_exports_folder");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Renders the first receipt page at exactly `dots` pixels wide and packs it as ESC/POS bytes. */
async function renderRaster(html: string, widthMm: number, dots: number) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthMm}mm;height:8000px;border:0;background:#fff;`;
  frame.srcdoc = html;
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  document.body.appendChild(frame);
  try {
    await Promise.race([loaded, wait(8000)]);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("تعذّر تجهيز الإيصال للطباعة.");
    try {
      await Promise.race([doc.fonts.ready, wait(4000)]);
    } catch {
      /* fall back to the bundled system font */
    }
    const slip = doc.querySelector<HTMLElement>(".slip");
    if (!slip) throw new Error("الإيصال غير جاهز للطباعة.");
    const cssWidth = slip.getBoundingClientRect().width;
    if (!cssWidth) throw new Error("عرض الإيصال غير معروف.");

    const { default: html2canvas } = await import("html2canvas-pro");
    const shot = await html2canvas(slip, {
      scale: dots / cssWidth,
      // Long receipts: render the whole slip, not only what fits in the frame's window.
      windowHeight: Math.max(slip.scrollHeight + 50, 1600),
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const canvas = document.createElement("canvas");
    canvas.width = dots;
    canvas.height = Math.max(1, Math.round((shot.height * dots) / shot.width));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("تعذّر تجهيز صورة الإيصال.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(shot, 0, 0, canvas.width, canvas.height);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const widthBytes = canvas.width / 8;
    const height = canvas.height;
    const packed = new Uint8Array(widthBytes * height);
    for (let y = 0; y < height; y++) {
      const row = y * widthBytes;
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const alpha = pixels[i + 3]!;
        const lum = (pixels[i]! * 299 + pixels[i + 1]! * 587 + pixels[i + 2]! * 114) / 1000;
        if (alpha > 90 && lum < 175) {
          const idx = row + (x >> 3);
          packed[idx] = (packed[idx] ?? 0) | (0x80 >> (x & 7));
        }
      }
    }

    // Never feed blank paper: cut white rows above and below the printed content.
    const trimmed = trimRaster(packed, widthBytes, height);
    let binary = "";
    for (let i = 0; i < trimmed.data.length; i += 0x8000) {
      binary += String.fromCharCode(...trimmed.data.subarray(i, i + 0x8000));
    }
    return { widthBytes, height: trimmed.height, data: btoa(binary) };
  } finally {
    frame.remove();
  }
}

/**
 * Removes the empty (all-white) raster rows above and below the printed content, keeping a
 * small margin (in dots, 8 dots = 1 mm at 203 dpi), so the roll is not wasted on blank paper.
 */
export function trimRaster(packed: Uint8Array, widthBytes: number, height: number, topDots = 8, bottomDots = 16) {
  const blank = (y: number) => {
    for (let i = y * widthBytes, end = i + widthBytes; i < end; i++) if (packed[i]) return false;
    return true;
  };
  let first = 0;
  while (first < height && blank(first)) first++;
  if (first >= height) return { data: new Uint8Array(widthBytes), height: 1 };
  let last = height - 1;
  while (last > first && blank(last)) last--;
  const top = Math.min(topDots, first);
  const bottom = Math.min(bottomDots, height - 1 - last);
  const rows = last - first + 1;
  const out = new Uint8Array(widthBytes * (top + rows + bottom));
  out.set(packed.subarray(first * widthBytes, (last + 1) * widthBytes), top * widthBytes);
  return { data: out, height: top + rows + bottom };
}

/** Head width in dots (203 dpi, multiple of 8) for a printable width in mm: 72 mm → 576, 48 mm → 384. */
export function dotsFor(printableMm: number) {
  return Math.min(832, Math.max(256, Math.round((printableMm * 203) / 25.4 / 8) * 8));
}

export async function printReceiptNative(
  html: string,
  opts: { widthMm: number; printableMm?: number; copies: number; printer: string; cut?: boolean },
) {
  if (!isNativePrint()) throw new Error("الطباعة المباشرة غير متاحة في هذا الإصدار.");
  // No printer picked on this device yet: use the Windows default printer instead of opening the
  // browser print window (which centres the slip on the driver's page and wastes paper).
  const printer = opts.printer || (await defaultPrinter().catch(() => ""));
  if (!printer) throw new Error("اختر طابعة الإيصالات من زر «طابعة الإيصالات».");
  const dots = dotsFor(opts.printableMm ?? (opts.widthMm === 58 ? 48 : 72));
  const raster = await renderRaster(html, opts.widthMm, dots);
  await invoke("print_receipt_raw", {
    printer,
    widthBytes: raster.widthBytes,
    height: raster.height,
    data: raster.data,
    copies: opts.copies,
    cut: opts.cut !== false,
  });
}
