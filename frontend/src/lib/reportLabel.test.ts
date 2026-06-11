import { describe, expect, it } from "vitest";
import { folderBase, reportDateLabel, reportDisplayLabel } from "./reportLabel";

const MODIFIED = 1781208023; // an arbitrary valid epoch-seconds timestamp

// The expected locale rendering of MODIFIED, computed the same way the helper
// does so the assertion is locale-independent.
const MODIFIED_LABEL = new Date(MODIFIED * 1000).toLocaleString(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

describe("reportDateLabel", () => {
  it("formats epoch seconds as a medium date + short time", () => {
    expect(reportDateLabel(MODIFIED)).toBe(MODIFIED_LABEL);
  });

  it("returns null for zero, negative, and non-finite timestamps", () => {
    expect(reportDateLabel(0)).toBeNull();
    expect(reportDateLabel(-5)).toBeNull();
    expect(reportDateLabel(Number.NaN)).toBeNull();
  });
});

describe("folderBase", () => {
  it("returns the last path segment", () => {
    expect(folderBase("outputs/ui_demo")).toBe("ui_demo");
    expect(folderBase("/tmp/current-run/")).toBe("current-run");
    expect(folderBase("C:\\scans\\study1")).toBe("study1");
  });

  it("returns the input when there is no separator", () => {
    expect(folderBase("ui_demo")).toBe("ui_demo");
  });
});

describe("reportDisplayLabel", () => {
  it("combines the date and the results-folder base name", () => {
    expect(
      reportDisplayLabel({ name: "brain_volumes_x.xlsx", outputDir: "outputs/ui_demo", modified: MODIFIED }),
    ).toBe(`${MODIFIED_LABEL} · ui_demo`);
  });

  it("falls back to the filename when the timestamp is unusable", () => {
    expect(
      reportDisplayLabel({ name: "brain_volumes_x.xlsx", outputDir: "outputs/ui_demo", modified: 0 }),
    ).toBe("brain_volumes_x.xlsx");
  });

  it("omits the separator when the folder is empty", () => {
    expect(reportDisplayLabel({ name: "r.xlsx", outputDir: "", modified: MODIFIED })).toBe(MODIFIED_LABEL);
  });
});
