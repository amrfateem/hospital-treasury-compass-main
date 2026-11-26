import { describe, expect, it } from "vitest";
import { handoverTotals, patientTrail, receiveStatus, type FileHandover, type HandoverItem } from "./handover";
import { emptyDB } from "./model";
import { runOp, type OpCtx } from "./ops";

const item = (patientName: string, mrn: string, received?: boolean): HandoverItem => ({ patientName, mrn, fileType: "ملف خروج", received });
const handover = (o: Partial<FileHandover> = {}): FileHandover => ({
  id: "h-1",
  number: "HND-1",
  date: "2026-06-01",
  time: "10:00",
  fromDept: "er",
  toDept: "records",
  purpose: "أرشفة",
  deliveredBy: "أحمد",
  status: "sent",
  createdAt: 100,
  items: [item("أحمد محمد", "MRN-101"), item("منى علي", "MRN-102")],
  ...o,
});
const ctx: OpCtx = { now: 1_000, today: "2026-06-01", actor: { id: "u1", name: "المدير", role: "admin" } };

describe("receiveStatus", () => {
  it("all files ticked → received", () => expect(receiveStatus([item("أ", "1", true), item("ب", "2", true)], false)).toBe("received"));
  it("some files ticked → partial", () => expect(receiveStatus([item("أ", "1", true), item("ب", "2", false)], false)).toBe("partial"));
  it("no file ticked → rejected", () => expect(receiveStatus([item("أ", "1", false), item("ب", "2")], false)).toBe("rejected"));
  it("reject flag wins even when everything is ticked", () => expect(receiveStatus([item("أ", "1", true)], true)).toBe("rejected"));
});

describe("handoverTotals", () => {
  it("counts waiting batches apart from received and missing files", () => {
    const list = [
      handover({ id: "a" }),
      handover({ id: "b", status: "received", items: [item("أ", "1", true), item("ب", "2", true)] }),
      handover({ id: "c", status: "partial", items: [item("أ", "1", true), item("ب", "2", false), item("ج", "3", false)] }),
    ];
    expect(handoverTotals(list)).toEqual({ batches: 3, files: 7, received: 3, missing: 2, waiting: 1 });
  });
});

describe("patientTrail", () => {
  const list = [
    handover({ id: "early", date: "2026-06-02", createdAt: 100 }),
    handover({ id: "old", date: "2026-05-31", createdAt: 9999 }),
    handover({ id: "latest", date: "2026-06-02", createdAt: 200, items: [item("أحمد محمد", "MRN-101", true)], status: "received" }),
  ];
  it("matches part of the name, newest first", () => expect(patientTrail(list, "محمد").map(({ h }) => h.id)).toEqual(["latest", "early", "old"]));
  it("matches only the exact file number", () => {
    expect(patientTrail(list, " MRN-102 ").map(({ h }) => h.id)).toEqual(["early", "old"]);
    expect(patientTrail(list, "MRN-10")).toEqual([]);
  });
});

describe("handover operations", () => {
  it("refuses handing files to the same department", () => {
    expect(() => runOp(emptyDB(), "saveFileHandover", handover({ toDept: "er" }), ctx)).toThrow("غير القسم المُسلِّم");
  });
  it("numbers a new handover and refuses receiving it twice", () => {
    let db = runOp(emptyDB(), "saveFileHandover", handover(), ctx);
    expect(db.fileHandovers[0]!.number).toBe("HND-20260601-001");
    db = runOp(db, "receiveFileHandover", { id: "h-1", received: [true, false], receivedBy: "منى", note: "ملف ناقص" }, ctx);
    expect(db.fileHandovers[0]!.status).toBe("partial");
    expect(() => runOp(db, "receiveFileHandover", { id: "h-1", received: [true, true], receivedBy: "منى" }, ctx)).toThrow("اتستلم قبل كده");
  });
  it("requires a note when a file is missing", () => {
    const db = runOp(emptyDB(), "saveFileHandover", handover(), ctx);
    expect(() => runOp(db, "receiveFileHandover", { id: "h-1", received: [true, false], receivedBy: "منى" }, ctx)).toThrow("ملاحظة");
  });
});
