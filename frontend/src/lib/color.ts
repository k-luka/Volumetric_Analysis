// Pure HSV <-> hex helpers for the custom color picker. No DOM, no deps.
//
// Hex parsing is tolerant in the same spirit as `hexToRgb` in segLut.ts: a
// leading "#" is optional, casing is ignored, 3-digit shorthand is expanded,
// and any garbage falls back to black ("#000000") rather than throwing. HSV
// uses h in [0, 360), s and v in [0, 1].

// Mid-grey-safe fallback color when a hex string cannot be parsed.
const FALLBACK_HEX = "#000000";

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) {
    return lo;
  }
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Parse a "#rrggbb" / "#rgb" hex string into an [r, g, b] byte triple.
 *
 * Tolerant: optional "#", case-insensitive, 3-digit shorthand expanded. Any
 * value that is not a valid 3- or 6-digit hex (after stripping "#") returns the
 * fallback (black) rather than throwing.
 */
function parseHex(hex: string): [number, number, number] {
  if (typeof hex !== "string") {
    return [0, 0, 0];
  }
  let h = hex.trim();
  if (h.startsWith("#")) {
    h = h.slice(1);
  }
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
    return [0, 0, 0];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHexByte(n: number): string {
  const v = clamp(Math.round(n), 0, 255);
  return v.toString(16).padStart(2, "0");
}

/**
 * Convert a tolerant hex string to HSV. Garbage falls back to black (h=0, s=0,
 * v=0). h is 0..360, s and v are 0..1. Greys yield s=0 (and h=0).
 */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const [r8, g8, b8] = parseHex(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

/**
 * Convert HSV to a "#rrggbb" hex string. Inputs are clamped (h wrapped into
 * [0,360), s and v into [0,1]); non-finite inputs fall back to 0 so the result
 * is always a valid hex.
 */
export function hsvToHex(h: number, s: number, v: number): string {
  if (!Number.isFinite(h) && !Number.isFinite(s) && !Number.isFinite(v)) {
    return FALLBACK_HEX;
  }
  let hh = Number.isFinite(h) ? h % 360 : 0;
  if (hh < 0) {
    hh += 360;
  }
  const ss = clamp(s, 0, 1);
  const vv = clamp(v, 0, 1);

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return `#${toHexByte((r + m) * 255)}${toHexByte((g + m) * 255)}${toHexByte((b + m) * 255)}`;
}
