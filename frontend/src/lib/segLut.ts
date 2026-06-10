// Pure builder for the segmentation overlay's NiiVue label LUT.
//
// The seg overlay (nv.volumes[1]) is recolored via `colormapLabel.lut`: a flat
// Uint8ClampedArray with four bytes [R, G, B, A] per label index, indexed
// 0..maxLabel. By default the whole brain is painted ONE uniform base color so
// the overlay reads as a single-color mask; a region menu then repaints the
// labels of the regions the user selects with their chosen colors. The rest of
// the brain stays the base color.
//
// Invariants this builder guarantees:
//  - length === (maxLabel + 1) * 4
//  - index 0 is fully transparent ([0, 0, 0, 0]) — id 0 is "background"
//  - NO GAPS: every index 1..maxLabel has a non-zero alpha (base or region),
//    so the overlay never has a black hole where a voxel maps to an unfilled
//    LUT slot.
//
// This module is pure: no NiiVue, no DOM. It only produces the byte array.

import type { AtlasRegion } from "../types";

// Highest FreeSurfer label id in the DKT+aseg segmentation (rh cortex tops out
// at 2035; see structures.py). The LUT must cover every index up to here.
export const SEG_MAX_LABEL = 2035;

// The NAME the seg volume MUST be loaded under in NiiVue. This is load-bearing,
// not cosmetic: NiiVue's MGZ reader only sets intent_code=1002 (selecting the
// integer per-label ATLAS shader, which renders crisp masks) when the volume
// name contains an entry from its hardcoded `mgLabelFiles` list. This string
// contains the entry "aparc.DKTatlas+aseg.deep.mg"; a generic name like
// "seg.mgz" would fall back to the scalar shader and bleed colors across label
// boundaries. See VolumeViewer for the full rationale. Centralized here so the
// component and its tests reference one source of truth.
export const SEG_LABEL_VOLUME_NAME = "aparc.DKTatlas+aseg.deep.mgz";

// Alpha for the uniform base mask vs. an explicitly selected region.
//
// NOTE: NiiVue's atlas fragment shader (scalar2color, fragOrientShaderAtlas)
// BINARIZES per-label alpha: `if (clr.a > 0.0) clr.a = 1.0; clr.a *= opacity`.
// Because the seg overlay is loaded at opacity 1, every label with a NON-ZERO
// LUT alpha renders fully opaque on the GPU regardless of whether that alpha is
// 140 or 225 — so these two constants do NOT make selected regions visually
// more opaque than the base mask. They control only transparent (alpha 0,
// special-cased to render nothing) vs. opaque (any alpha > 0). Selected regions
// therefore differ from the base mask by COLOR, not opacity. The two distinct
// values are kept for clarity / as a non-zero "present" marker; downstream code
// (and tests) still keys off them to distinguish base vs. region voxels.
export const BASE_ALPHA = 140;
export const REGION_ALPHA = 225;

// RGB used when a color string cannot be parsed. Mid grey keeps the voxel
// visible (never a black hole) while signalling "unspecified".
const FALLBACK_RGB: [number, number, number] = [128, 128, 128];

// key = region.key; color = "#rrggbb". `on` toggles whether the region is
// painted with its color (true) or left at the base color (false / absent).
// `opacity` (0..1, optional) is the per-region transparency used by the
// multi-overlay renderer (see buildSegLayers); it is IGNORED by buildSegLut,
// which only produces colors, so existing { on, color } callers keep working.
export type RegionSelection = Record<string, { on: boolean; color: string; opacity?: number }>;

// One overlay volume's worth of the segmentation render. `lut` is the flat
// NiiVue label LUT for that overlay and `opacity` is the single per-overlay
// alpha multiplier NiiVue applies on the GPU.
//
// WHY one layer PER selected region instead of a single LUT: NiiVue's atlas
// fragment shader BINARIZES per-label alpha (`if (clr.a > 0.0) clr.a = 1.0;
// clr.a *= opacity`), where `opacity` is ONE uniform PER overlay volume. So a
// label's transparency CANNOT come from its LUT alpha — every non-zero-alpha
// label renders fully opaque, then is scaled by the overlay's single opacity.
// To give each selected region its OWN graduated transparency, each region must
// live in its own overlay volume with its own `opacity`. buildSegLayers returns:
// a BASE layer that paints everything EXCEPT the selected regions (so the base's
// opacity dims the unselected brain), then one layer per selected region (only
// that region's labels painted) whose opacity dims just that region. Labels are
// one-per-voxel, so the overlays never overlap and their draw order is
// irrelevant to correctness.
export type SegLayer = { key: string; lut: Uint8ClampedArray; opacity: number };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Parse a "#rrggbb" / "#rgb" hex color into an [r, g, b] byte triple.
 *
 * Tolerant: a leading "#" is optional, casing is ignored, and 3-digit
 * shorthand ("#f00") is expanded. Any string that is not valid hex of length
 * 3 or 6 (after stripping "#") falls back to FALLBACK_RGB (mid grey) rather
 * than throwing, so a bad color never produces a transparent/black voxel.
 */
export function hexToRgb(hex: string): [number, number, number] {
  if (typeof hex !== "string") {
    return [...FALLBACK_RGB];
  }
  let h = hex.trim();
  if (h.startsWith("#")) {
    h = h.slice(1);
  }
  if (h.length === 3) {
    // Expand shorthand: "abc" -> "aabbcc".
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
    return [...FALLBACK_RGB];
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Build the seg-overlay label LUT.
 *
 * Returns a Uint8ClampedArray of length (maxLabel + 1) * 4:
 *  - index 0 => [0, 0, 0, 0] (transparent background)
 *  - every index 1..maxLabel => baseColor RGB + BASE_ALPHA by default
 *  - for each region whose selection[region.key]?.on === true, every label of
 *    that region (clamped to <= maxLabel) is overwritten with the region's
 *    color RGB + REGION_ALPHA.
 *
 * Labels greater than maxLabel (or negative) are ignored safely. The result is
 * guaranteed to have NO index in 1..maxLabel with alpha 0.
 */
export function buildSegLut(
  regions: AtlasRegion[],
  selection: RegionSelection,
  baseColor: string,
  maxLabel: number = SEG_MAX_LABEL,
): Uint8ClampedArray {
  const lut = new Uint8ClampedArray((maxLabel + 1) * 4);

  const [br, bg, bb] = hexToRgb(baseColor);
  // Fill 1..maxLabel with the uniform base color. Index 0 stays [0,0,0,0]
  // because the array initializes to zeros.
  for (let i = 1; i <= maxLabel; i++) {
    const off = i * 4;
    lut[off] = br;
    lut[off + 1] = bg;
    lut[off + 2] = bb;
    lut[off + 3] = BASE_ALPHA;
  }

  // Repaint selected regions. Later regions win on overlap, but in practice one
  // label belongs to at most one region so order does not matter.
  for (const region of regions) {
    const sel = selection[region.key];
    if (!sel || sel.on !== true) {
      continue;
    }
    const [rr, rg, rb] = hexToRgb(sel.color);
    for (const label of region.labels) {
      // Guard against ids outside the LUT range (negative, 0, or > maxLabel).
      if (!Number.isInteger(label) || label < 1 || label > maxLabel) {
        continue;
      }
      const off = label * 4;
      lut[off] = rr;
      lut[off + 1] = rg;
      lut[off + 2] = rb;
      lut[off + 3] = REGION_ALPHA;
    }
  }

  return lut;
}

/**
 * Build the per-overlay seg layers for graduated per-region opacity.
 *
 * Returns an array whose first element is ALWAYS the BASE overlay and whose
 * remaining elements are one overlay per selected region (in catalog order):
 *
 *  - Layer 0 ("base"): index 0 = [0,0,0,0]; every label 1..maxLabel = baseColor
 *    RGB + BASE_ALPHA, EXCEPT labels belonging to a selected (on === true)
 *    region, which are set fully transparent [0,0,0,0] so that region's own
 *    overlay shows through to the anatomy below. Its overlay opacity is
 *    `baseOpacity`.
 *  - One layer per selected region: index 0 transparent, ALL labels transparent
 *    EXCEPT this region's in-range labels = region color RGB + REGION_ALPHA.
 *    Its overlay opacity is clamp01(selection[key].opacity ?? 1).
 *
 * See the SegLayer doc comment for why opacity must come from per-overlay
 * `opacity` rather than LUT alpha. With every opacity at 1 this renders
 * identically to the single-LUT buildSegLut output (base paints unselected,
 * regions paint selected, same colors).
 */
export function buildSegLayers(
  regions: AtlasRegion[],
  selection: RegionSelection,
  baseColor: string,
  maxLabel: number = SEG_MAX_LABEL,
  baseOpacity: number = 1,
): SegLayer[] {
  const inRange = (label: number): boolean =>
    Number.isInteger(label) && label >= 1 && label <= maxLabel;

  // BASE layer: uniform base color everywhere except selected regions (which are
  // punched transparent so their dedicated overlay composites over anatomy).
  const baseLut = new Uint8ClampedArray((maxLabel + 1) * 4);
  const [br, bg, bb] = hexToRgb(baseColor);
  for (let i = 1; i <= maxLabel; i++) {
    const off = i * 4;
    baseLut[off] = br;
    baseLut[off + 1] = bg;
    baseLut[off + 2] = bb;
    baseLut[off + 3] = BASE_ALPHA;
  }
  for (const region of regions) {
    const sel = selection[region.key];
    if (!sel || sel.on !== true) {
      continue;
    }
    for (const label of region.labels) {
      if (!inRange(label)) {
        continue;
      }
      const off = label * 4;
      baseLut[off] = 0;
      baseLut[off + 1] = 0;
      baseLut[off + 2] = 0;
      baseLut[off + 3] = 0;
    }
  }

  const layers: SegLayer[] = [{ key: "base", lut: baseLut, opacity: clamp01(baseOpacity) }];

  // One overlay per selected region: only that region's labels are painted.
  for (const region of regions) {
    const sel = selection[region.key];
    if (!sel || sel.on !== true) {
      continue;
    }
    const lut = new Uint8ClampedArray((maxLabel + 1) * 4);
    const [rr, rg, rb] = hexToRgb(sel.color);
    for (const label of region.labels) {
      if (!inRange(label)) {
        continue;
      }
      const off = label * 4;
      lut[off] = rr;
      lut[off + 1] = rg;
      lut[off + 2] = rb;
      lut[off + 3] = REGION_ALPHA;
    }
    layers.push({ key: region.key, lut, opacity: clamp01(sel.opacity ?? 1) });
  }

  return layers;
}
