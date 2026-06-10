import type {
  RunProgress,
  ValidateOutputResponse,
  ValidateScansResponse,
} from "../types";

export const idleProgress: RunProgress = {
  state: "idle",
  percent: 0,
  label: "No run",
  detail: "Progress appears after analysis starts.",
  currentFile: null,
  counts: null,
};

export function messageFromPayload(payload: Record<string, unknown>): string | null {
  const value = payload.message;
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseEvent(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function numberFromPayload(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringFromPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scanCountLabel(index: number | null, total: number | null): string | null {
  if (index === null || total === null || total <= 0) {
    return null;
  }
  return `${index} of ${total} scans`;
}

export function progressFromEvent(eventName: string, payload: Record<string, unknown>): RunProgress {
  const index = numberFromPayload(payload, "index");
  const total = numberFromPayload(payload, "total");
  const filename = stringFromPayload(payload, "filename");
  const message = messageFromPayload(payload);
  const counts = scanCountLabel(index, total);
  const scanBase = 12;
  const scanSpan = 72;

  if (eventName === "start") {
    return {
      state: "running",
      percent: total !== null && total > 0 ? 8 : 4,
      label: total !== null && total > 0 ? "Preparing scans" : "Starting analysis",
      detail: total !== null && total > 0 ? `${total} scan${total === 1 ? "" : "s"} queued for analysis.` : (message ?? "Starting the analysis run."),
      currentFile: null,
      counts: total !== null && total > 0 ? `0 of ${total} scans` : null,
    };
  }

  if (eventName === "scan_start") {
    const completedBefore = index !== null && total !== null && total > 0 ? (index - 1) / total : 0;
    return {
      state: "running",
      percent: clampPercent(scanBase + completedBefore * scanSpan + 6),
      label: "Segmenting scan",
      detail: filename ?? message ?? "Processing scan.",
      currentFile: filename,
      counts,
    };
  }

  if (eventName === "scan_done") {
    const completed = index !== null && total !== null && total > 0 ? index / total : 0.85;
    return {
      state: "running",
      percent: clampPercent(scanBase + completed * scanSpan),
      label: "Scan finished",
      detail: message ?? filename ?? "Scan processing finished.",
      currentFile: filename,
      counts,
    };
  }

  if (eventName === "analysis_summary") {
    return {
      state: "running",
      percent: 90,
      label: "Summarizing results",
      detail: message ?? "Preparing report data.",
      currentFile: null,
      counts: total !== null ? `${total} scan${total === 1 ? "" : "s"} analyzed` : null,
    };
  }

  if (eventName === "report_written") {
    return {
      state: "running",
      percent: 96,
      label: "Report written",
      detail: message ?? "Report artifacts are ready.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "complete") {
    return {
      state: "complete",
      percent: 100,
      label: "Analysis complete",
      detail: message ?? "Results are ready.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "cancelled") {
    return {
      state: "cancelled",
      percent: 100,
      label: "Run cancelled",
      detail: message ?? "Analysis cancelled.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "error") {
    return {
      state: "error",
      percent: 100,
      label: "Run failed",
      detail: message ?? "Analysis failed.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "no_scans") {
    return {
      state: "error",
      percent: 100,
      label: "No scans found",
      detail: message ?? "No .nii or .nii.gz scans were found.",
      currentFile: null,
      counts: null,
    };
  }

  return {
    state: "running",
    percent: 8,
    label: "Running analysis",
    detail: message ?? eventName,
    currentFile: null,
    counts: null,
  };
}

export function folderValidationMessage(scanResult: ValidateScansResponse, outputResult: ValidateOutputResponse): string | null {
  if (!scanResult.exists || scanResult.scanCount === 0) {
    return "Select at least one .nii or .nii.gz scan to analyze.";
  }
  if (scanResult.problems.length > 0) {
    const first = scanResult.problems[0];
    return `${first.name}: ${first.error}`;
  }
  if (scanResult.readableCount === 0) {
    return "No readable scans were selected. Check the files and voxel spacing.";
  }
  if (outputResult.status !== "ok" || !outputResult.canWrite) {
    return outputResult.message;
  }
  return null;
}
