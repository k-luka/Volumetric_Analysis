// Default whole-brain mask color when no regions are picked: the overlay reads
// as ONE uniform color over the whole brain.
export const DEFAULT_BASE_COLOR = "#3a8bff";

// Distinct, reasonably distinguishable defaults handed to region color pickers
// in catalog order so two adjacent regions never start out the same color. The
// user can override any of them. Cycled if the catalog is longer than the list.
export const REGION_COLOR_PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#f58231",
  "#911eb4",
  "#46f0f0",
  "#f032e6",
  "#bcf60c",
  "#fabebe",
  "#008080",
  "#9a6324",
  "#800000",
  "#aaffc3",
  "#808000",
  "#000075",
  "#e6beff",
];

export function defaultRegionColor(index: number): string {
  return REGION_COLOR_PALETTE[index % REGION_COLOR_PALETTE.length];
}
