import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex } from "./color";

// Round-trip a hex through HSV and back. Allow a small per-channel tolerance for
// the float math + rounding.
function roundTrip(hex: string): string {
  const { h, s, v } = hexToHsv(hex);
  return hsvToHex(h, s, v);
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function expectClose(a: string, b: string, tol = 1): void {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  expect(Math.abs(ar - br)).toBeLessThanOrEqual(tol);
  expect(Math.abs(ag - bg)).toBeLessThanOrEqual(tol);
  expect(Math.abs(ab - bb)).toBeLessThanOrEqual(tol);
}

describe("hexToHsv / hsvToHex round-trip", () => {
  it("round-trips primaries within rounding tolerance", () => {
    expectClose(roundTrip("#ff0000"), "#ff0000");
    expectClose(roundTrip("#00ff00"), "#00ff00");
    expectClose(roundTrip("#0000ff"), "#0000ff");
  });

  it("round-trips white, black, and mid grey", () => {
    expectClose(roundTrip("#ffffff"), "#ffffff");
    expectClose(roundTrip("#000000"), "#000000");
    expectClose(roundTrip("#808080"), "#808080");
  });

  it("round-trips an arbitrary color", () => {
    expectClose(roundTrip("#3a8bff"), "#3a8bff");
    expectClose(roundTrip("#ff8800"), "#ff8800");
  });
});

describe("hexToHsv parsing", () => {
  it("parses 3-digit shorthand like #abc", () => {
    expect(hexToHsv("#abc")).toEqual(hexToHsv("#aabbcc"));
  });

  it("accepts hex without a leading #", () => {
    expect(hexToHsv("ff0000")).toEqual(hexToHsv("#ff0000"));
  });

  it("falls back to black on garbage", () => {
    expect(hexToHsv("not-a-color")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv("#12")).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("reports s=0 for greys (no hue)", () => {
    expect(hexToHsv("#808080").s).toBe(0);
    expect(hexToHsv("#ffffff").s).toBe(0);
  });

  it("gives red a hue near 0 and green near 120", () => {
    expect(hexToHsv("#ff0000").h).toBeCloseTo(0, 1);
    expect(hexToHsv("#00ff00").h).toBeCloseTo(120, 1);
    expect(hexToHsv("#0000ff").h).toBeCloseTo(240, 1);
  });
});

describe("hsvToHex clamping", () => {
  it("clamps out-of-range s and v into [0,1]", () => {
    expect(hsvToHex(0, 5, 5)).toBe("#ff0000");
    expect(hsvToHex(0, -1, -1)).toBe("#000000");
  });

  it("wraps hue past 360", () => {
    expectClose(hsvToHex(360, 1, 1), hsvToHex(0, 1, 1));
    expectClose(hsvToHex(480, 1, 1), hsvToHex(120, 1, 1));
  });

  it("always returns a valid 6-digit hex", () => {
    expect(hsvToHex(123.4, 0.5, 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
