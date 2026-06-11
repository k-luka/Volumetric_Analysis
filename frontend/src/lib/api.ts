import type {
  AtlasRegion,
  DefaultsResponse,
  OpenResultsFolderResponse,
  ReportDetail,
  ReportSummary,
  RuntimeCheck,
  RunStatus,
  SelectDirectoryResponse,
  SelectFilesResponse,
  ValidateOutputResponse,
  ValidateScansResponse,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function apiUrl(path: string): string {
  if (path.startsWith("http")) {
    return path;
  }
  return `${API_BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
      }
    } catch {
      // Keep the plain response text when the API did not return JSON.
    }
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function getDefaults(): Promise<DefaultsResponse> {
  return request<DefaultsResponse>("/api/defaults");
}

export function validateScans(inputDir: string, recursive: boolean, scanPaths?: string[]): Promise<ValidateScansResponse> {
  return request<ValidateScansResponse>("/api/scans/validate", {
    method: "POST",
    body: JSON.stringify({ inputDir, recursive, scanPaths: scanPaths ?? null }),
  });
}

export function validateOutput(outputDir: string): Promise<ValidateOutputResponse> {
  return request<ValidateOutputResponse>("/api/output/validate", {
    method: "POST",
    body: JSON.stringify({ outputDir }),
  });
}

export function createOutputFolder(outputDir: string): Promise<ValidateOutputResponse> {
  return request<ValidateOutputResponse>("/api/output/create", {
    method: "POST",
    body: JSON.stringify({ outputDir }),
  });
}

export function selectDirectory(initialDir: string, title = "Select folder"): Promise<SelectDirectoryResponse> {
  return request<SelectDirectoryResponse>("/api/paths/select-directory", {
    method: "POST",
    body: JSON.stringify({ initialDir, title }),
  });
}

export function selectFiles(initialDir: string, title = "Select scans"): Promise<SelectFilesResponse> {
  return request<SelectFilesResponse>("/api/paths/select-files", {
    method: "POST",
    body: JSON.stringify({ initialDir, title }),
  });
}

export async function startRun(payload: {
  inputDir?: string;
  outputDir: string;
  recursive: boolean;
  deviceChoice: string;
  scanPaths?: string[];
}): Promise<string> {
  const result = await request<{ runId: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return result.runId;
}

export function getRun(runId: string): Promise<RunStatus> {
  return request<RunStatus>(`/api/runs/${runId}`);
}

export function cancelRun(runId: string): Promise<RunStatus> {
  return request<RunStatus>(`/api/runs/${runId}/cancel`, { method: "POST" });
}

export function getReports(): Promise<ReportSummary[]> {
  return request<ReportSummary[]>("/api/reports");
}

export function getReport(id: string): Promise<ReportDetail> {
  return request<ReportDetail>(`/api/reports/${id}`);
}

export function openResultsFolder(path: string): Promise<OpenResultsFolderResponse> {
  return request<OpenResultsFolderResponse>("/api/reports/open-folder", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function getChecks(): Promise<RuntimeCheck[]> {
  return request<RuntimeCheck[]>("/api/checks");
}

export function getAtlasRegions(): Promise<{ maxLabel: number; regions: AtlasRegion[] }> {
  return request<{ maxLabel: number; regions: AtlasRegion[] }>("/api/atlas/regions");
}

export function openDownload(path: string | null): void {
  if (!path) {
    return;
  }
  window.location.assign(apiUrl(path));
}

export function openArtifact(path: string | null): void {
  if (!path) {
    return;
  }
  window.open(apiUrl(path), "_blank", "noopener,noreferrer");
}

export function createRunEventSource(runId: string): EventSource {
  return new EventSource(apiUrl(`/api/runs/${runId}/events`));
}
