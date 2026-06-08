import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupPanel } from "./SetupPanel";
import type { RuntimeReadiness } from "../types";

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

const runtimeFailed: RuntimeReadiness = {
  state: "failed",
  label: "System issue",
  detail: "FastSurfer: Cannot find python3.10.",
  checkedAt: "2026-06-04T00:00:00.000Z",
};

const baseProps = {
  scanPaths: ["data/tutorial/anat.nii.gz"],
  outputDir: "outputs/ui_demo",
  deviceChoice: "auto",
  deviceChoices: ["auto", "cpu", "mps", "cuda"],
  validation: null,
  outputValidation: null,
  isRunning: false,
  isCancelling: false,
  isCheckingRuntime: false,
  runtimeReadiness: runtimeUnknown,
  isSelectingScans: false,
  isSelectingOutputDir: false,
  onDeviceChoiceChange: vi.fn(),
  onSelectScans: vi.fn(),
  onClearScans: vi.fn(),
  onSelectOutputDir: vi.fn(),
  onCheckRuntime: vi.fn(),
  onRun: vi.fn(),
  onCancelRun: vi.fn(),
  viewerControlsVisible: false,
  viewerHasVolume: false,
  viewerMode: "montage" as const,
  onViewerModeChange: vi.fn(),
};

describe("SetupPanel", () => {
  it("lets users choose scans", () => {
    const onSelectScans = vi.fn();
    render(<SetupPanel {...baseProps} onSelectScans={onSelectScans} />);

    fireEvent.click(screen.getByRole("button", { name: /choose different scans/i }));

    expect(onSelectScans).toHaveBeenCalledTimes(1);
  });

  it("lists the selected scan files and clears them", () => {
    const onClearScans = vi.fn();
    render(<SetupPanel {...baseProps} scanPaths={["data/tutorial/anat.nii.gz", "/scans/sub-02.nii"]} onClearScans={onClearScans} />);

    expect(screen.getByText("2 scans selected")).toBeInTheDocument();
    expect(screen.getByText("anat.nii.gz")).toBeInTheDocument();
    expect(screen.getByText("sub-02.nii")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClearScans).toHaveBeenCalledTimes(1);
  });

  it("lets users select the results folder", () => {
    const onSelectOutputDir = vi.fn();
    render(<SetupPanel {...baseProps} onSelectOutputDir={onSelectOutputDir} />);

    fireEvent.click(screen.getByRole("button", { name: /choose results folder/i }));

    expect(onSelectOutputDir).toHaveBeenCalledTimes(1);
  });

  it("disables the pickers while running", () => {
    render(<SetupPanel {...baseProps} isRunning />);

    expect(screen.getByRole("button", { name: /choose different scans/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /choose results folder/i })).toBeDisabled();
  });

  it("swaps in a Stop button while running and cancels the run", () => {
    const onCancelRun = vi.fn();
    render(<SetupPanel {...baseProps} isRunning onCancelRun={onCancelRun} />);

    expect(screen.queryByRole("button", { name: /check selection/i })).not.toBeInTheDocument();
    const stop = screen.getByRole("button", { name: /^stop$/i });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });

  it("shows a stopping state once cancellation is in flight", () => {
    render(<SetupPanel {...baseProps} isRunning isCancelling />);

    expect(screen.getByRole("button", { name: /stopping/i })).toBeDisabled();
  });

  it("allows running once scans and output are selected", () => {
    render(<SetupPanel {...baseProps} />);

    expect(screen.getByRole("button", { name: /run analysis/i })).toBeEnabled();
    expect(screen.getByText("System not checked")).toBeInTheDocument();
  });

  it("lets users check runtime from the setup panel", () => {
    const onCheckRuntime = vi.fn();
    render(<SetupPanel {...baseProps} onCheckRuntime={onCheckRuntime} />);

    fireEvent.click(screen.getByRole("button", { name: /check system status/i }));

    expect(onCheckRuntime).toHaveBeenCalledTimes(1);
  });

  it("shows ready and failed runtime states", () => {
    const { rerender } = render(<SetupPanel {...baseProps} runtimeReadiness={runtimeReady} />);

    expect(screen.getByText("System ready")).toBeInTheDocument();
    expect(screen.getByText("Checks passed.")).toBeInTheDocument();

    rerender(<SetupPanel {...baseProps} runtimeReadiness={runtimeFailed} />);

    expect(screen.getByText("System issue")).toBeInTheDocument();
    expect(screen.getByText("FastSurfer: Cannot find python3.10.")).toBeInTheDocument();
  });

  it("disables running while runtime is being checked", () => {
    render(
      <SetupPanel
        {...baseProps}
        isCheckingRuntime
        runtimeReadiness={{
          state: "checking",
          label: "Checking system",
          detail: "Python and FastSurfer.",
          checkedAt: null,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /recheck system status/i })).toBeDisabled();
  });

  it("enables run when validation finds readable scans and usable output", () => {
    render(
      <SetupPanel
        {...baseProps}
        validation={{ exists: true, scanCount: 1, readableCount: 1, scans: [], problems: [] }}
        outputValidation={{
          path: "outputs/ui_demo",
          exists: true,
          isDirectory: true,
          parentExists: true,
          canCreate: false,
          canWrite: true,
          status: "ok",
          message: "Results folder is writable.",
        }}
      />,
    );

    expect(screen.getByText(/1 scan file/i)).toBeInTheDocument();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeEnabled();
  });

  it("does not mark an empty selection as ready", () => {
    render(
      <SetupPanel
        {...baseProps}
        validation={{ exists: true, scanCount: 0, readableCount: 0, scans: [], problems: [] }}
      />,
    );

    expect(screen.getByText(/No scans selected/i)).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("shows unreadable scan problems", () => {
    render(
      <SetupPanel
        {...baseProps}
        validation={{
          exists: true,
          scanCount: 1,
          readableCount: 0,
          scans: [],
          problems: [{ path: "/blocked.nii", name: "blocked.nii", error: "Could not read voxel spacing." }],
        }}
      />,
    );

    expect(screen.getByText(/Could not read voxel spacing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("keeps run disabled when the output path is invalid", () => {
    render(
      <SetupPanel
        {...baseProps}
        validation={{ exists: true, scanCount: 1, readableCount: 1, scans: [], problems: [] }}
        outputValidation={{
          path: "outputs/file",
          exists: true,
          isDirectory: false,
          parentExists: true,
          canCreate: false,
          canWrite: false,
          status: "error",
          message: "Results path exists but is not a folder.",
        }}
      />,
    );

    expect(screen.getByText("Not ready")).toBeInTheDocument();
    expect(screen.getByText(/not a folder/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("shows empty-state hints before a selection is made", () => {
    render(<SetupPanel {...baseProps} scanPaths={[]} outputDir="" />);

    expect(screen.getByText(/No scans selected\. Click/i)).toBeInTheDocument();
    expect(screen.getByText("No results folder selected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });

  it("hides the viewer mode buttons until the segmentation view is open", () => {
    const { rerender } = render(<SetupPanel {...baseProps} viewerControlsVisible={false} />);

    expect(screen.queryByText("Segmentation view")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Montage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Slices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3D" })).not.toBeInTheDocument();

    rerender(<SetupPanel {...baseProps} viewerControlsVisible viewerHasVolume />);

    expect(screen.getByText("Segmentation view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Montage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3D" })).toBeInTheDocument();
  });

  it("disables Slices/3D and shows a persistent hint when no volume is available", () => {
    render(<SetupPanel {...baseProps} viewerControlsVisible viewerHasVolume={false} />);

    expect(screen.getByRole("button", { name: "Montage" })).toBeEnabled();
    const slices = screen.getByRole("button", { name: "Slices" });
    const threeD = screen.getByRole("button", { name: "3D" });
    expect(slices).toBeDisabled();
    expect(threeD).toBeDisabled();

    // The caption is a persistent, screen-reader-linked hint, not a hover title.
    const hint = screen.getByText(/Interactive viewer unavailable for this report/i);
    expect(hint).toBeVisible();
    expect(slices).toHaveAttribute("aria-describedby", hint.id);
    expect(threeD).toHaveAttribute("aria-describedby", hint.id);
  });

  it("enables every mode and drops the hint once a volume is available", () => {
    render(<SetupPanel {...baseProps} viewerControlsVisible viewerHasVolume />);

    expect(screen.getByRole("button", { name: "Montage" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Slices" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeEnabled();
    expect(screen.queryByText(/Interactive viewer unavailable for this report/i)).not.toBeInTheDocument();
  });

  it("marks the active mode as pressed and fires onViewerModeChange when a mode is clicked", () => {
    const onViewerModeChange = vi.fn();
    render(
      <SetupPanel
        {...baseProps}
        viewerControlsVisible
        viewerHasVolume
        viewerMode="slices"
        onViewerModeChange={onViewerModeChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Slices" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Montage" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(onViewerModeChange).toHaveBeenCalledWith("3d");
  });
});
