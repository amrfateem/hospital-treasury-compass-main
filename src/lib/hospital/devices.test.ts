import { describe, expect, it } from "vitest";
import { addMonths, deviceSchedule, devicesSummary, maintenanceCost, type MedicalDevice, type DeviceLog } from "./devices";
import { BUILT_IN_GUIDES, guidesForDepartment, suggestGuide } from "./calibration-guides";

const device: MedicalDevice = {
  id: "d1", code: "ICU-01", name: "تنفس صناعي", department: "icu",
  status: "working", risk: "high", maintenanceEveryMonths: 6,
  calibrationEveryMonths: 12, installDate: "2026-01-10", createdAt: 1,
};
const preventive: DeviceLog = {
  id: "l1", deviceId: "d1", kind: "preventive", date: "2026-01-10",
  performedBy: "مهندس", description: "فحص", cost: 125.25, createdAt: 1,
};
describe("medical device helpers", () => {
  it("clamps month ends and handles leap years and year boundaries", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
  });
  it("derives overdue preventive maintenance", () => {
    expect(deviceSchedule(device, [preventive], "2026-08-01").maintenance)
      .toMatchObject({ state: "overdue", next: "2026-07-10", last: "2026-01-10" });
  });
  it("honors explicit nextDue", () => {
    expect(deviceSchedule(device, [{ ...preventive, nextDue: "2026-10-01" }], "2026-08-01").maintenance)
      .toMatchObject({ state: "ok", next: "2026-10-01" });
  });
  it("does not schedule retired devices", () => {
    const schedule = deviceSchedule({ ...device, status: "retired" }, [preventive], "2026-08-01");
    expect(schedule.maintenance.state).toBe("none");
    expect(schedule.calibration.state).toBe("none");
  });
  it("counts active, down, due and soon devices", () => {
    const devices: MedicalDevice[] = [device,
      { ...device, id: "d2", status: "out", installDate: "2026-02-15" },
      { ...device, id: "d3", status: "retired" },
      { ...device, id: "d4", status: "maintenance", installDate: undefined },
    ];
    expect(devicesSummary(devices, [preventive], "2026-08-01")).toEqual({
      total: 3, working: 1, down: 2, maintenanceDue: 2, calibrationDue: 1, soon: 1,
    });
  });
  it("sums inclusive range costs and groups by device", () => {
    const costs = maintenanceCost([preventive,
      { ...preventive, id: "l2", deviceId: "d2", date: "2026-01-31", cost: 74.75 },
      { ...preventive, id: "l3", date: "2026-02-01", cost: 999 },
    ], "2026-01-10", "2026-01-31");
    expect(costs.total).toBe(200);
    expect(costs.count).toBe(2);
    expect(costs.byDevice.get("d1")).toBe(125.25);
    expect(costs.byDevice.get("d2")).toBe(74.75);
  });
});
describe("calibration reference library", () => {
  it("has unique IDs, concrete steps and acceptance criteria", () => {
    expect(new Set(BUILT_IN_GUIDES.map(g => g.id)).size).toBe(BUILT_IN_GUIDES.length);
    for (const guide of BUILT_IN_GUIDES) {
      expect(guide.steps.length).toBeGreaterThanOrEqual(5);
      expect(guide.acceptance.length).toBeGreaterThanOrEqual(1);
      expect(guide.standard).toBeTruthy();
    }
  });
  it("includes ventilator and all general guides in ICU", () => {
    const guides = guidesForDepartment("icu", []);
    expect(guides.some(g => g.deviceType === "جهاز تنفس صناعي")).toBe(true);
    for (const guide of BUILT_IN_GUIDES.filter(g => g.departments.includes("*"))) {
      expect(guides).toContain(guide);
    }
  });
  it("filters hospital custom guides to the selected department", () => {
    const own = { id: "own", department: "icu", deviceType: "خاص", title: "خاص", interval: "سنوي", tools: [], steps: [], acceptance: [], createdAt: 1 };
    expect(guidesForDepartment("icu", [own])).toContain(own);
    expect(guidesForDepartment("lab", [own])).not.toContain(own);
  });
  it("suggests by device type and does not guess empty input", () => {
    expect(suggestGuide("جهاز تنفس صناعي", "icu")?.id).toBe("builtin-ventilator");
    expect(suggestGuide("", "icu")).toBeUndefined();
    expect(suggestGuide("جهاز تنفس صناعي", "lab")).toBeUndefined();
  });
});
