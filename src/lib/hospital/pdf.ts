/**
 * Exports an <OfficialDocument> (rendered off-screen) to an A4 PDF.
 * The letterhead is rasterised once and stamped on every page; the body is sliced
 * at row boundaries ([data-pdf-break]) so table rows never split across pages.
 * Rendering goes through the browser (html2canvas-pro) so Arabic shaping is correct.
 */
type JsPdf = InstanceType<typeof import("jspdf").jsPDF>;

/** Exports one rendered <OfficialDocument> to a PDF file. */
export async function exportOfficialPdf(root: HTMLElement, filename: string) {
  const batch = await startOfficialPdf();
  await batch.add(root);
  batch.save(filename);
}

/**
 * Builds one PDF out of several documents rendered one after another (e.g. a batch of
 * receipts): call add() for each rendered root, then save().
 */
export async function startOfficialPdf() {
  await document.fonts.ready;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);
  let pdf: JsPdf | null = null;

  async function add(root: HTMLElement) {
    const header = root.querySelector<HTMLElement>("[data-pdf-header]");
    const body = root.querySelector<HTMLElement>("[data-pdf-body]");
    if (!header || !body) throw new Error("Document is not ready");
    const orientation = (root.dataset["orientation"] as "portrait" | "landscape") || "portrait";
    const format = (root.dataset["format"] as "a4" | "a5") || "a4";

    const scale = 2;
    const capture = (el: HTMLElement) =>
      html2canvas(el, {
        scale,
        backgroundColor: "#ffffff",
        useCORS: true,
        onclone: (doc) => {
          const r = doc.querySelector<HTMLElement>("[data-pdf-root]");
          if (r) {
            r.style.left = "0px";
            r.style.top = "0px";
          }
        },
      });

    const [headerCanvas, bodyCanvas] = [await capture(header), await capture(body)];

    const first = !pdf;
    if (!pdf) pdf = new jsPDF({ orientation, unit: "mm", format, compress: true });
    const doc = pdf;
    if (!first) doc.addPage(format, orientation);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 6;
    const footer = 8;
    const contentW = pageW - margin * 2;
    const pxPerMm = bodyCanvas.width / contentW;
    const headerH = headerCanvas.height / pxPerMm;
    const availPx = (pageH - margin * 2 - footer - headerH) * pxPerMm;

    const bodyTop = body.getBoundingClientRect().top;
    const breaks = Array.from(body.querySelectorAll<HTMLElement>("[data-pdf-break]"))
      .map((n) => Math.round((n.getBoundingClientRect().bottom - bodyTop) * scale))
      .sort((a, b) => a - b);

    const headerImg = headerCanvas.toDataURL("image/jpeg", 0.95);
    const slices: [number, number][] = [];
    let y = 0;
    while (y < bodyCanvas.height - 1) {
      let end = Math.min(y + availPx, bodyCanvas.height);
      if (end < bodyCanvas.height) {
        const fit = breaks.filter((b) => b > y + 40 && b <= end);
        if (fit.length) end = fit[fit.length - 1]!;
      }
      slices.push([y, end]);
      y = end;
    }

    slices.forEach(([from, to], i) => {
      if (i > 0) doc.addPage(format, orientation);
      doc.addImage(headerImg, "JPEG", margin, margin, contentW, headerH);
      const c = document.createElement("canvas");
      c.width = bodyCanvas.width;
      c.height = Math.max(1, to - from);
      c.getContext("2d")!.drawImage(bodyCanvas, 0, from, c.width, c.height, 0, 0, c.width, c.height);
      doc.addImage(
        c.toDataURL("image/jpeg", 0.95),
        "JPEG",
        margin,
        margin + headerH,
        contentW,
        c.height / pxPerMm,
      );
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(`${i + 1} / ${slices.length}`, pageW / 2, pageH - margin, { align: "center" });
    });
  }

  function save(filename: string) {
    if (!pdf) throw new Error("Nothing to save");
    pdf.save(filename);
  }

  return { add, save };
}
