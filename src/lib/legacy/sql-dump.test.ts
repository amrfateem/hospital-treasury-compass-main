import { describe, expect, it } from "vitest";
import { fixMojibake, parseDump, parseValues } from "./sql-dump";

describe("old system backup reader", () => {
  it("repairs Arabic saved in the wrong encoding", () => {
    expect(fixMojibake("Ø§Ø­Ù…Ø¯")).toBe("احمد");
    expect(fixMojibake("محمد")).toBe("محمد");
  });
  it("splits quoted fields with escapes and commas", () => {
    expect(parseValues('"1","a, \\"b\\"","",NULL,5')).toEqual(["1", 'a, "b"', "", "", "5"]);
  });
  it("groups rows by table", () => {
    const t = parseDump('INSERT INTO patients VALUES("1","تيست");\nINSERT INTO paid VALUES("2","x","15");\njunk');
    expect(t.get("patients")).toEqual([["1", "تيست"]]);
    expect(t.get("paid")?.[0]?.[2]).toBe("15");
  });
});
