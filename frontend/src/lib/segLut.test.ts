import { describe, expect, it } from "vitest";

import type { AtlasRegion } from "../types";
import {
  BASE_ALPHA,
  REGION_ALPHA,
  SEG_MAX_LABEL,
  buildSegLut,
  hexToRgb,
  type RegionSelection,
} from "./segLut";

// Mirror of the backend catalog (structures.py atlas_regions): keys are slugs
// of the display names. We only need the handful of regions the assertions
// touch; their label ids match the FreeSurfer ids in structures.py.
const HIPPOCAMPUS: AtlasRegion = {
  key: "hippocampus",
  name: "Hippocampus",
  group: "Medial temporal",
  labels: [17, 53],
};
const CORTEX: AtlasRegion = {
  key: "cerebral-cortex",
  name: "Cerebral cortex",
  group: "Cerebrum",
  // lh 1000-1035 + rh 2000-2035; the endpoints 1000 and 2035 are what we assert.
  labels: [
    ...Array.from({ length: 36 }, (_, i) => 1000 + i),
    ...Array.from({ length: 36 }, (_, i) => 2000 + i),
  ],
};
const AMYGDALA: AtlasRegion = {
  key: "amygdala",
  name: "Amygdala",
  group: "Medial temporal",
  labels: [18, 54],
};

const BASE = "#3366cc";
const [BR, BG, BB] = hexToRgb(BASE);

function rgba(lut: Uint8ClampedArray, index: number): [number, number, number, number] {
  const off = index * 4;
  return [lut[off], lut[off + 1], lut[off + 2], lut[off + 3]];
}

describe("hexToRgb", () => {
  it("parses #rrggbb", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("#00ff00")).toEqual([0, 255, 0]);
    expect(hexToRgb("#0000ff")).toEqual([0, 0, 255]);
  });

  it("tolerates missing #, whitespace, and casing", () => {
    expect(hexToRgb("FF0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("  #AbCdEf  ")).toEqual([0xab, 0xcd, 0xef]);
  });

  it("expands 3-digit shorthand", () => {
    expect(hexToRgb("#f00")).toEqual([255, 0, 0]);
    expect(hexToRgb("abc")).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it("falls back to mid grey on invalid input", () => {
    expect(hexToRgb("")).toEqual([128, 128, 128]);
    expect(hexToRgb("#zzzzzz")).toEqual([128, 128, 128]);
    expect(hexToRgb("#12345")).toEqual([128, 128, 128]);
    expect(hexToRgb("not a color")).toEqual([128, 128, 128]);
    // @ts-expect-error exercising the runtime guard for non-string input
    expect(hexToRgb(null)).toEqual([128, 128, 128]);
  });
});

describe("buildSegLut", () => {
  it("has length (maxLabel + 1) * 4", () => {
    const lut = buildSegLut([], {}, BASE);
    expect(lut).toBeInstanceOf(Uint8ClampedArray);
    expect(lut.length).toBe((SEG_MAX_LABEL + 1) * 4);

    const small = buildSegLut([], {}, BASE, 10);
    expect(small.length).toBe((10 + 1) * 4);
  });

  it("makes index 0 fully transparent", () => {
    const lut = buildSegLut([], {}, BASE);
    expect(rgba(lut, 0)).toEqual([0, 0, 0, 0]);
  });

  it("fills every label 1..maxLabel with the base color + BASE_ALPHA", () => {
    const lut = buildSegLut([], {}, BASE);
    for (let i = 1; i <= SEG_MAX_LABEL; i++) {
      expect(rgba(lut, i)).toEqual([BR, BG, BB, BASE_ALPHA]);
    }
  });

  it("has NO gap: no index in 1..maxLabel ever has alpha 0 (no-gaps invariant)", () => {
    // Default fill.
    const base = buildSegLut([], {}, BASE);
    for (let i = 1; i <= SEG_MAX_LABEL; i++) {
      expect(base[i * 4 + 3]).not.toBe(0);
    }
    // And with regions selected, coverage still holds everywhere.
    const selection: RegionSelection = {
      hippocampus: { on: true, color: "#ff0000" },
      "cerebral-cortex": { on: true, color: "#00ff00" },
    };
    const withRegions = buildSegLut([HIPPOCAMPUS, CORTEX], selection, BASE);
    for (let i = 1; i <= SEG_MAX_LABEL; i++) {
      expect(withRegions[i * 4 + 3]).not.toBe(0);
    }
  });

  it("colors a selected region's labels (17, 53) red while a neighbor (16) stays base", () => {
    const selection: RegionSelection = {
      hippocampus: { on: true, color: "#ff0000" },
    };
    const lut = buildSegLut([HIPPOCAMPUS], selection, BASE);

    expect(rgba(lut, 17)).toEqual([255, 0, 0, REGION_ALPHA]);
    expect(rgba(lut, 53)).toEqual([255, 0, 0, REGION_ALPHA]);
    // The adjacent label 16 (brainstem) is not part of the selection.
    expect(rgba(lut, 16)).toEqual([BR, BG, BB, BASE_ALPHA]);
  });

  it("does not color a region when its selection is off or absent", () => {
    const off: RegionSelection = { hippocampus: { on: false, color: "#ff0000" } };
    const lutOff = buildSegLut([HIPPOCAMPUS], off, BASE);
    expect(rgba(lutOff, 17)).toEqual([BR, BG, BB, BASE_ALPHA]);

    const lutAbsent = buildSegLut([HIPPOCAMPUS], {}, BASE);
    expect(rgba(lutAbsent, 17)).toEqual([BR, BG, BB, BASE_ALPHA]);
  });

  it("colors cortex endpoints 1000 and 2035 when selected", () => {
    const selection: RegionSelection = {
      "cerebral-cortex": { on: true, color: "#00ff00" },
    };
    const lut = buildSegLut([CORTEX], selection, BASE);

    expect(rgba(lut, 1000)).toEqual([0, 255, 0, REGION_ALPHA]);
    expect(rgba(lut, 2035)).toEqual([0, 255, 0, REGION_ALPHA]);
    // A non-cortex subcortical label stays base.
    expect(rgba(lut, 17)).toEqual([BR, BG, BB, BASE_ALPHA]);
  });

  it("keeps two selected regions from bleeding into each other", () => {
    const selection: RegionSelection = {
      hippocampus: { on: true, color: "#ff0000" },
      amygdala: { on: true, color: "#0000ff" },
    };
    const lut = buildSegLut([HIPPOCAMPUS, AMYGDALA], selection, BASE);

    expect(rgba(lut, 17)).toEqual([255, 0, 0, REGION_ALPHA]);
    expect(rgba(lut, 53)).toEqual([255, 0, 0, REGION_ALPHA]);
    expect(rgba(lut, 18)).toEqual([0, 0, 255, REGION_ALPHA]);
    expect(rgba(lut, 54)).toEqual([0, 0, 255, REGION_ALPHA]);
  });

  it("falls back to grey for an invalid region color but stays opaque", () => {
    const selection: RegionSelection = {
      hippocampus: { on: true, color: "nonsense" },
    };
    const lut = buildSegLut([HIPPOCAMPUS], selection, BASE);
    expect(rgba(lut, 17)).toEqual([128, 128, 128, REGION_ALPHA]);
    expect(rgba(lut, 53)).toEqual([128, 128, 128, REGION_ALPHA]);
  });

  it("falls back to grey for an invalid base color across all labels", () => {
    const lut = buildSegLut([], {}, "garbage");
    expect(rgba(lut, 1)).toEqual([128, 128, 128, BASE_ALPHA]);
    expect(rgba(lut, SEG_MAX_LABEL)).toEqual([128, 128, 128, BASE_ALPHA]);
  });

  it("ignores labels greater than maxLabel without overflowing the array", () => {
    const region: AtlasRegion = {
      key: "synthetic",
      name: "Synthetic",
      group: "Test",
      labels: [5, 9999, 2036],
    };
    const selection: RegionSelection = { synthetic: { on: true, color: "#ff0000" } };
    const lut = buildSegLut([region], selection, BASE, SEG_MAX_LABEL);

    // In-range label is colored.
    expect(rgba(lut, 5)).toEqual([255, 0, 0, REGION_ALPHA]);
    // Out-of-range labels are dropped; the array length is unchanged.
    expect(lut.length).toBe((SEG_MAX_LABEL + 1) * 4);
  });

  it("ignores non-integer and non-positive labels safely", () => {
    const region: AtlasRegion = {
      key: "weird",
      name: "Weird",
      group: "Test",
      labels: [0, -3, 2.5, 17],
    };
    const selection: RegionSelection = { weird: { on: true, color: "#ff0000" } };
    const lut = buildSegLut([region], selection, BASE);

    // Index 0 must remain transparent even though the region listed label 0.
    expect(rgba(lut, 0)).toEqual([0, 0, 0, 0]);
    // The one valid label is colored.
    expect(rgba(lut, 17)).toEqual([255, 0, 0, REGION_ALPHA]);
  });

  it("respects a custom maxLabel and fills it densely", () => {
    const lut = buildSegLut([HIPPOCAMPUS], { hippocampus: { on: true, color: "#ff0000" } }, BASE, 60);
    expect(lut.length).toBe((60 + 1) * 4);
    expect(rgba(lut, 17)).toEqual([255, 0, 0, REGION_ALPHA]);
    expect(rgba(lut, 53)).toEqual([255, 0, 0, REGION_ALPHA]);
    for (let i = 1; i <= 60; i++) {
      expect(lut[i * 4 + 3]).not.toBe(0);
    }
  });
});
