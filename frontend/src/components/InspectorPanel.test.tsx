import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectorPanel } from "./InspectorPanel";
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
        onReportsRefresh={vi.fn()}
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
        onReportsRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText(/hasn't been saved to a results folder yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /brain_volumes_current/i })).toBeInTheDocument();
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
        onReportsRefresh={vi.fn()}
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
        onReportsRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getAllByText("FastSurfer failed with exit code 1").length).toBeGreaterThan(0);
    expect(screen.getByText("[1/1] scan.nii - segmenting...")).toBeInTheDocument();
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
        onReportsRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /recheck system/i })).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("3.10.20")).toBeInTheDocument();
  });
});
