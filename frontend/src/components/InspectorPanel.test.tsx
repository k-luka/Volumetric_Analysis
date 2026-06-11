import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectorPanel } from "./InspectorPanel";
import { reportDisplayLabel } from "../lib/reportLabel";
import type { ReportDetail, ReportSummary, RuntimeCheck, RuntimeReadiness, RunProgress, RunStatus } from "../types";

vi.mock("../lib/api", () => ({
  openArtifact: vi.fn(),
  openDownload: vi.fn(),
}));

const savedReport: ReportSummary = {
  id: "saved-report",
  name: "brain_volumes_saved.xlsx",
  outputDir: "outputs/ui_demo",
  reportPath: "outputs/ui_demo/reports/brain_volumes_saved.xlsx",
  modified: 2,
  source: "saved",
  temporary: false,
};

const currentRunReport: ReportSummary = {
  id: "current-run-report",
  name: "brain_volumes_current.xlsx",
  outputDir: "/tmp/current-run",
  reportPath: "/tmp/current-run/reports/brain_volumes_current.xlsx",
  modified: 3,
  source: "current_run",
  temporary: true,
};

const idleProgress: RunProgress = {
  state: "idle",
  percent: 0,
  label: "No run",
  detail: "Progress appears after analysis starts.",
  currentFile: null,
  counts: null,
};

const failedProgress: RunProgress = {
  state: "error",
  percent: 100,
  label: "Run failed",
  detail: "FastSurfer failed with exit code 1",
  currentFile: null,
  counts: null,
};

const failedStatus: RunStatus = {
  runId: "run-1",
  state: "error",
  inputDir: "/input",
  outputDir: "/output",
  recursive: false,
  device: "cpu",
  latestEvent: { event: "error", payload: { message: "FastSurfer failed with exit code 1" } },
  logs: ["Run started.", "[1/1] scan.nii - segmenting...", "FastSurfer failed with exit code 1"],
  reportId: null,
  artifacts: { xlsx: false, pdf: false, color: false, binary: false },
  error: "FastSurfer failed with exit code 1",
};

const runtimeUnknown: RuntimeReadiness = {
  state: "unknown",
  label: "System not checked",
  detail: "Will check before run.",
  checkedAt: null,
};

const runtimeReady: RuntimeReadiness = {
  state: "ready",
  label: "System ready",
  detail: "Checks passed.",
  checkedAt: "2026-06-04T00:00:00.000Z",
};

const readyChecks: RuntimeCheck[] = [
  {
    label: "Python",
    status: "ok",
    detail: "3.10.20",
  },
];

function detail(summary: ReportSummary): ReportDetail {
  return {
    id: summary.id,
    summary,
    metadata: {
      modified: summary.modified,
      source: summary.source,
      inputDir: null,
      outputDir: summary.outputDir,
      reportPath: summary.reportPath,
      device: null,
      runState: null,
      runId: null,
      temporary: summary.temporary,
    },
    scan: { subject: "scan", filename: "scan", spacing: "1 x 1 x 1 mm" },
    rows: [],
    metrics: [],
    structures: [],
    qc: [],
    artifacts: {
      xlsx: "/api/reports/current-run-report/download/xlsx",
      pdf: null,
      color: "/api/reports/current-run-report/images/color",
    },
  };
}

describe("InspectorPanel", () => {
  it("does not auto-load a saved report on mount", () => {
    const onOpenReport = vi.fn();
    render(
      <InspectorPanel
        reports={[savedReport]}
        activeReport={null}
        runStatus={null}
        runProgress={idleProgress}
        logs={[]}
        runtimeChecks={[]}
        runtimeReadiness={runtimeUnknown}
        isCheckingRuntime={false}
        onCheckRuntime={vi.fn()}
        onOpenReport={onOpenReport}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /select result/i })).toBeInTheDocument();
    expect(onOpenReport).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /download excel/i })).toBeDisabled();
  });

  it("shows current-run report availability context", () => {
    render(
      <InspectorPanel
        reports={[currentRunReport, savedReport]}
        activeReport={detail(currentRunReport)}
        runStatus={null}
        runProgress={idleProgress}
        logs={[]}
        runtimeChecks={[]}
        runtimeReadiness={runtimeUnknown}
        isCheckingRuntime={false}
        onCheckRuntime={vi.fn()}
        onOpenReport={vi.fn()}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    expect(screen.getByText(/hasn't been saved to a results folder yet/i)).toBeInTheDocument();
    // The trigger shows the humanized "date · folder" label, not the raw filename.
    expect(screen.getByRole("button", { name: new RegExp(reportDisplayLabel(currentRunReport)) })).toBeInTheDocument();
  });

  it("disables missing artifact actions", () => {
    render(
      <InspectorPanel
        reports={[currentRunReport]}
        activeReport={detail(currentRunReport)}
        runStatus={null}
        runProgress={idleProgress}
        logs={[]}
        runtimeChecks={[]}
        runtimeReadiness={runtimeUnknown}
        isCheckingRuntime={false}
        onCheckRuntime={vi.fn()}
        onOpenReport={vi.fn()}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /download excel/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeDisabled();
    // Segmentation is no longer a download row — it lives only in the "Segmentation check" tab.
    expect(screen.queryByRole("button", { name: /view segmentation/i })).not.toBeInTheDocument();
  });

  it("shows failed run state and preserved logs", () => {
    render(
      <InspectorPanel
        reports={[]}
        activeReport={null}
        runStatus={failedStatus}
        runProgress={failedProgress}
        logs={failedStatus.logs}
        runtimeChecks={[]}
        runtimeReadiness={runtimeUnknown}
        isCheckingRuntime={false}
        onCheckRuntime={vi.fn()}
        onOpenReport={vi.fn()}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getAllByText("FastSurfer failed with exit code 1").length).toBeGreaterThan(0);
    expect(screen.getByText("[1/1] scan.nii - segmenting...")).toBeInTheDocument();
  });

  it("shows the live run state and selected device while a run is in flight", () => {
    const runningProgress: RunProgress = {
      state: "running",
      percent: 40,
      label: "Segmenting scan",
      detail: "scan.nii.gz",
      currentFile: "scan.nii.gz",
      counts: "0 of 1 scans",
    };
    render(
      <InspectorPanel
        reports={[]}
        activeReport={null}
        runStatus={null}
        runProgress={runningProgress}
        logs={[]}
        runtimeChecks={[]}
        runtimeReadiness={runtimeReady}
        isCheckingRuntime={false}
        deviceChoice="mps"
        onCheckRuntime={vi.fn()}
        onOpenReport={vi.fn()}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    // runStatus is only fetched at terminal events; the card must not claim
    // "idle" while SSE progress says the run is live.
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByText("idle")).not.toBeInTheDocument();
    expect(screen.getByText("mps")).toBeInTheDocument();
  });

  it("shows the relocated per-scan results for the active report", () => {
    const reportWithRows: ReportDetail = {
      ...detail(savedReport),
      rows: [
        {
          filename: "sub-01.nii.gz",
          path: "/scans/sub-01.nii.gz",
          subject_id: "sub-01",
          input_spacing_mm: "1 x 1 x 1",
          segmentation_spacing_mm: "1 x 1 x 1",
          voxel_count: 0,
          volume_mm3: 0,
          volume_ml: 1246.35,
          status: "ok",
          error: "",
        },
        {
          filename: "sub-02.nii.gz",
          path: "/scans/sub-02.nii.gz",
          subject_id: "sub-02",
          input_spacing_mm: "1 x 1 x 1",
          segmentation_spacing_mm: "1 x 1 x 1",
          voxel_count: 0,
          volume_mm3: 0,
          volume_ml: 0,
          status: "error",
          error: "Could not read voxel spacing.",
        },
      ],
    };

    render(
      <InspectorPanel
        reports={[savedReport]}
        activeReport={reportWithRows}
        runStatus={null}
        runProgress={idleProgress}
        logs={[]}
        runtimeChecks={[]}
        runtimeReadiness={runtimeUnknown}
        isCheckingRuntime={false}
        onCheckRuntime={vi.fn()}
        onOpenReport={vi.fn()}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    expect(screen.getByText("Scan results")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /scan results/i });
    expect(within(table).getByText("sub-01.nii.gz")).toBeInTheDocument();
    expect(within(table).getByText("sub-02.nii.gz")).toBeInTheDocument();
    // Volume is formatted with separators in its own column (unit in the header).
    expect(within(table).getByText("1,246.35")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /vol \(ml\)/i })).toBeInTheDocument();
    // The failed scan surfaces its status and error.
    expect(within(table).getByText("error")).toBeInTheDocument();
    expect(within(table).getByText("Could not read voxel spacing.")).toBeInTheDocument();
  });

  it("notes when the active report has no scan rows", () => {
    render(
      <InspectorPanel
        reports={[savedReport]}
        activeReport={detail(savedReport)}
        runStatus={null}
        runProgress={idleProgress}
        logs={[]}
        runtimeChecks={[]}
        runtimeReadiness={runtimeUnknown}
        isCheckingRuntime={false}
        onCheckRuntime={vi.fn()}
        onOpenReport={vi.fn()}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    expect(screen.getByText("Scan results")).toBeInTheDocument();
    expect(screen.getByText(/No scan rows are available/i)).toBeInTheDocument();
  });

  it("uses shared runtime diagnostics state", () => {
    const onCheckRuntime = vi.fn();
    render(
      <InspectorPanel
        reports={[]}
        activeReport={null}
        runStatus={null}
        runProgress={idleProgress}
        logs={[]}
        runtimeChecks={readyChecks}
        runtimeReadiness={runtimeReady}
        isCheckingRuntime={false}
        onCheckRuntime={onCheckRuntime}
        onOpenReport={vi.fn()}
        isOpeningResultsFolder={false}
        onReportsRefresh={vi.fn()}
        onOpenResultsFolder={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /recheck system/i })).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("3.10.20")).toBeInTheDocument();
  });
});
