import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createRunEventSource, getChecks, getDefaults, getReport, getRun, selectFiles, startRun, validateOutput, validateScans } from "./lib/api";

vi.mock("./lib/api", () => ({
  apiUrl: (path: string) => path,
  cancelRun: vi.fn(),
  createRunEventSource: vi.fn(),
  getChecks: vi.fn(),
  getDefaults: vi.fn(),
  getReport: vi.fn(),
  getReports: vi.fn(async () => []),
  getRun: vi.fn(),
  openArtifact: vi.fn(),
  openDownload: vi.fn(),
  selectDirectory: vi.fn(),
  selectFiles: vi.fn(),
  startRun: vi.fn(),
  validateOutput: vi.fn(),
  validateScans: vi.fn(),
}));

const SCAN_PATHS = ["/data/scans/scan.nii.gz"];

const defaults = {
  inputDir: "/data/scans",
  outputDir: "/data/results",
  recursive: false,
  defaultDevice: "auto",
  deviceChoices: ["auto", "cpu"],
  sampleAvailable: true,
  reports: [],
};

class FakeRunEventSource {
  listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  closed = false;

  addEventListener(name: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(name: string, payload: Record<string, unknown>) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(payload) } as MessageEvent<string>);
    }
  }

  emitRaw(name: string) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({} as MessageEvent<string>);
    }
  }
}

// Render App, wait for defaults to settle (output folder populated), then pick scans
// through the (mocked) native file picker so the run controls become enabled.
async function renderWithScans(paths: string[] = SCAN_PATHS) {
  render(<App />);
  await screen.findByText("/data/results");
  vi.mocked(selectFiles).mockResolvedValue({ selected: true, paths, message: null });
  fireEvent.click(screen.getByRole("button", { name: /choose scans/i }));
  await screen.findByText(`${paths.length} scan${paths.length === 1 ? "" : "s"} selected`);
  await waitFor(() => expect(screen.getByRole("button", { name: /run analysis/i })).toBeEnabled());
}

describe("App run flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDefaults).mockResolvedValue(defaults);
    vi.mocked(validateScans).mockResolvedValue({ exists: true, scanCount: 1, readableCount: 1, scans: [], problems: [] });
    vi.mocked(validateOutput).mockResolvedValue({
      path: "/data/results",
      exists: true,
      isDirectory: true,
      parentExists: true,
      canCreate: false,
      canWrite: true,
      status: "ok",
      message: "Results folder is writable.",
    });
  });

  it("starts with an empty results canvas even when saved reports exist", async () => {
    vi.mocked(getDefaults).mockResolvedValue({
      ...defaults,
      reports: [
        {
          id: "saved-report",
          name: "brain_volumes_saved.xlsx",
          outputDir: "outputs/ui_demo",
          reportPath: "outputs/ui_demo/reports/brain_volumes_saved.xlsx",
          modified: 1,
          source: "saved",
          temporary: false,
        },
      ],
    });

    render(<App />);

    expect(await screen.findByText("No result loaded")).toBeInTheDocument();
    expect(screen.queryByText("Subject")).not.toBeInTheDocument();
    expect(getReport).not.toHaveBeenCalled();
  });

  it("picks scans through the native picker and enables the run", async () => {
    await renderWithScans();

    expect(screen.getByText("scan.nii.gz")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeEnabled();
  });

  it("blocks a real run when runtime checks fail", async () => {
    vi.mocked(getChecks).mockResolvedValue([
      {
        label: "FastSurfer",
        status: "fail",
        detail: "Cannot find python3.10.",
      },
    ]);

    await renderWithScans();

    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    expect(await screen.findAllByText(/System is not ready/i)).not.toHaveLength(0);
    expect(validateScans).toHaveBeenCalledWith("", false, SCAN_PATHS);
    expect(validateOutput).toHaveBeenCalledWith("/data/results");
    expect(getChecks).toHaveBeenCalledTimes(1);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("auto-validates the selection and disables Run when no readable scans remain", async () => {
    vi.mocked(validateScans).mockResolvedValue({ exists: true, scanCount: 0, readableCount: 0, scans: [], problems: [] });

    render(<App />);
    await screen.findByText("/data/results");
    vi.mocked(selectFiles).mockResolvedValue({ selected: true, paths: SCAN_PATHS, message: null });
    fireEvent.click(screen.getByRole("button", { name: /choose scans/i }));
    await screen.findByText("1 scan selected");

    // Auto-validation runs with no button and proactively blocks an unrunnable selection.
    await waitFor(() => expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled());
    expect(screen.getByText(/No scans selected/i)).toBeInTheDocument();
    expect(getChecks).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  it("caches an explicit runtime check and reuses it for run", async () => {
    const source = new FakeRunEventSource();
    vi.mocked(getChecks).mockResolvedValue([
      {
        label: "Python",
        status: "ok",
        detail: "3.10.20",
      },
    ]);
    vi.mocked(startRun).mockResolvedValue("run-cached");
    vi.mocked(createRunEventSource).mockReturnValue(source as unknown as EventSource);

    await renderWithScans();
    fireEvent.click(screen.getByRole("button", { name: /check system status/i }));

    expect(await screen.findByText("System ready")).toBeInTheDocument();
    expect(getChecks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    expect(getChecks).toHaveBeenCalledTimes(1);
  });

  it("shows failed run details, preserves logs, and enables running again", async () => {
    const source = new FakeRunEventSource();
    vi.mocked(getChecks).mockResolvedValue([]);
    vi.mocked(startRun).mockResolvedValue("run-1");
    vi.mocked(createRunEventSource).mockReturnValue(source as unknown as EventSource);
    vi.mocked(getRun).mockResolvedValue({
      runId: "run-1",
      state: "error",
      inputDir: "/data/scans",
      outputDir: "/data/results",
      recursive: false,
      device: "cpu",
      latestEvent: { event: "error", payload: { message: "FastSurfer failed with exit code 1" } },
      logs: ["Run started.", "[1/1] scan.nii - segmenting...", "FastSurfer failed with exit code 1"],
      reportId: null,
      artifacts: { xlsx: false, pdf: false, color: false, binary: false },
      error: "FastSurfer failed with exit code 1",
    });

    await renderWithScans();
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));

    source.emit("start", { message: "Run started." });
    source.emit("scan_start", { message: "[1/1] scan.nii - segmenting...", filename: "scan.nii", index: 1, total: 1 });
    source.emit("error", { message: "FastSurfer failed with exit code 1" });

    expect((await screen.findAllByText("FastSurfer failed with exit code 1")).length).toBeGreaterThan(0);
    expect(screen.getByText("[1/1] scan.nii - segmenting...")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /run analysis/i })).toBeEnabled());
    expect(source.closed).toBe(true);
  });

  it("reports a cancelled run from the stream", async () => {
    const source = new FakeRunEventSource();
    vi.mocked(getChecks).mockResolvedValue([]);
    vi.mocked(startRun).mockResolvedValue("run-cancel");
    vi.mocked(createRunEventSource).mockReturnValue(source as unknown as EventSource);
    vi.mocked(getRun).mockResolvedValue({
      runId: "run-cancel",
      state: "cancelled",
      inputDir: "/data/scans",
      outputDir: "/data/results",
      recursive: false,
      device: "cpu",
      latestEvent: { event: "cancelled", payload: { message: "Run cancelled." } },
      logs: ["Run started.", "Run cancelled."],
      reportId: null,
      artifacts: { xlsx: false, pdf: false, color: false, binary: false },
      error: "Run cancelled.",
    });

    await renderWithScans();
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument());
    source.emit("start", { message: "Run started." });
    source.emit("cancelled", { message: "Run cancelled." });

    expect((await screen.findAllByText("Run cancelled.")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("button", { name: /run analysis/i })).toBeEnabled());
    expect(source.closed).toBe(true);
  });

  it("uses backend run status when a stream error has no message payload", async () => {
    const source = new FakeRunEventSource();
    vi.mocked(getChecks).mockResolvedValue([]);
    vi.mocked(startRun).mockResolvedValue("run-2");
    vi.mocked(createRunEventSource).mockReturnValue(source as unknown as EventSource);
    vi.mocked(getRun).mockResolvedValue({
      runId: "run-2",
      state: "error",
      inputDir: "/data/scans",
      outputDir: "/data/results",
      recursive: false,
      device: "cpu",
      latestEvent: null,
      logs: ["Run started.", "Segmentation process exited unexpectedly."],
      reportId: null,
      artifacts: { xlsx: false, pdf: false, color: false, binary: false },
      error: "Segmentation process exited unexpectedly.",
    });

    await renderWithScans();
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));

    source.emit("start", { message: "Run started." });
    source.emitRaw("error");

    expect(await screen.findAllByText("Segmentation process exited unexpectedly.")).not.toHaveLength(0);
    expect(screen.getByText("Run started.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /run analysis/i })).toBeEnabled());
    expect(source.closed).toBe(true);
  });
});
