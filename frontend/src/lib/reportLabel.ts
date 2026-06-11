import type { ReportSummary } from "../types";

// "Jun 10, 2026, 8:20 PM" — locale-aware; null when the timestamp is unusable.
export function reportDateLabel(modifiedSeconds: number): string | null {
  if (!Number.isFinite(modifiedSeconds) || modifiedSeconds <= 0) {
    return null;
  }
  return new Date(modifiedSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Last path segment of the results folder ("outputs/ui_demo" -> "ui_demo").
export function folderBase(outputDir: string): string {
  const parts = outputDir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? outputDir;
}

// Human-first label for a saved report: "Jun 10, 2026, 8:20 PM · ui_demo".
// The raw brain_volumes_*.xlsx filenames differ only in their embedded
// timestamps, so the date plus results-folder is what actually identifies a
// report. Falls back to the filename when no usable timestamp exists.
export function reportDisplayLabel(report: Pick<ReportSummary, "name" | "outputDir" | "modified">): string {
  const date = reportDateLabel(report.modified);
  if (!date) {
    return report.name;
  }
  const folder = folderBase(report.outputDir);
  return folder ? `${date} · ${folder}` : date;
}
