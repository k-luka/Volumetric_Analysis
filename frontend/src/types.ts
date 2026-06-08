
// One selectable region in the segmentation overlay. `labels` are the
// FreeSurfer label ids (from structures.py) that belong to this region; the
// seg LUT colors every one of those ids when the region is selected.
export type AtlasRegion = {
  key: string;
  name: string;
  group: string;
  labels: number[];
};

export type ReportSummary = {
  id: string;
  name: string;
  outputDir: string;
  reportPath: string;
  modified: number;
  source: "saved" | "current_run";
  temporary: boolean;
};

export type DefaultsResponse = {
  inputDir: string;
  outputDir: string;
  recursive: boolean;
  defaultDevice: string;
  deviceChoices: string[];
  sampleAvailable: boolean;
  reports: ReportSummary[];
};

export type ScanInfo = {
  path: string;
  name: string;
  spacing: string;
};

export type ScanProblem = {
  path: string;
  name: string;
  error: string;
};

export type ValidateScansResponse = {
  exists: boolean;
  scanCount: number;
  readableCount: number;
  scans: ScanInfo[];
  problems: ScanProblem[];
};

export type ValidateOutputResponse = {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  parentExists: boolean;
  canCreate: boolean;
  canWrite: boolean;
  status: "ok" | "warn" | "error";
  message: string;
};

export type SelectDirectoryResponse = {
  selected: boolean;
  path: string | null;
  message: string | null;
};

export type SelectFilesResponse = {
  selected: boolean;
  paths: string[];
  message: string | null;
};

export type Metric = {
  label: string;
  value: number | null;
  unit: string;
  sub: string;
};

export type StructureVolume = {
  structure: string;
  group: string;
  leftMl: number | null;
  rightMl: number | null;
  totalMl: number | null;
  asymmetryPct: number | null;
};

export type ReportRow = {
  filename: string;
  path: string;
  subject_id: string;
  input_spacing_mm: string;
  segmentation_spacing_mm: string;
  voxel_count: string | number;
  volume_mm3: string | number;
  volume_ml: string | number;
  status: string;
  error: string;
};

export type ReportDetail = {
  id: string;
  summary: ReportSummary;
  metadata: {
    modified: number;
    source: "saved" | "current_run";
    inputDir: string | null;
    outputDir: string;
    reportPath: string;
    device: string | null;
    runState: "queued" | "running" | "complete" | "error" | "cancelled" | null;
    runId: string | null;
    temporary: boolean;
  };
  scan: {
    subject: string;
    filename: string;
    spacing: string;
  };
  rows: ReportRow[];
  metrics: Metric[];
  structures: StructureVolume[];
  qc: QcScan[];
  artifacts: {
    xlsx: string | null;
    pdf: string | null;
    color: string | null;
  };
};

export type QcScan = {
  subject: string;
  filename: string;
  status: string;
  color: string | null;
  anat: string | null;
  seg: string | null;
};

export type ViewerMode = "montage" | "slices" | "3d";

export type RunStatus = {
  runId: string;
  state: "queued" | "running" | "complete" | "error" | "cancelled";
  inputDir: string;
  outputDir: string;
  recursive: boolean;
  device: string;
  latestEvent: { event: string; payload: Record<string, unknown> } | null;
  logs: string[];
  reportId: string | null;
  artifacts: Record<string, boolean>;
  error: string | null;
};

export type RunProgress = {
  state: "idle" | "queued" | "running" | "complete" | "error" | "cancelled";
  percent: number;
  label: string;
  detail: string;
  currentFile: string | null;
  counts: string | null;
};

export type RuntimeCheck = {
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
};

export type RuntimeReadiness = {
  state: "unknown" | "checking" | "ready" | "warning" | "failed";
  label: string;
  detail: string;
  checkedAt: string | null;
};
