import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasRegion, ReportDetail, RunProgress, ViewerMode } from "../types";

// Stub out the interactive NiiVue viewer so these tests never touch WebGL.
// We surface the props it receives so the rail tests can assert that the
// anatomical/segmentation URLs and mode are forwarded correctly. The LUT byte
// length is surfaced so a test can prove a region edit rebuilds it, and the
// actual LUT reference is captured in `lastSegLut` so the region-menu tests can
// read back the exact bytes the component forwarded (e.g. index 17 after a
// hippocampus edit) without poking through the real NiiVue surface.
let lastSegLut: Uint8ClampedArray | null = null;

vi.mock("./VolumeViewer", () => ({
  default: ({
    anatUrl,
    segUrl,
    mode,
    segLut,
  }: {
    anatUrl: string;
    segUrl: string | null;
    mode: string;
    segLut?: Uint8ClampedArray | null;
  }) => {
    lastSegLut = segLut ?? null;
    return (
      <div
        data-testid="volume-viewer"
        data-anat={anatUrl}
        data-seg={segUrl ?? ""}
        data-mode={mode}
        data-seglut-len={segLut ? String(segLut.length) : ""}
      >
        volume-viewer
      </div>
    );
  },
}));

// Read the [R, G, B, A] bytes at a given label index out of the most recently
// forwarded seg LUT. Throws if the viewer never received a LUT so a misuse
// surfaces as a clear failure rather than a silent null.
function lutRgba(index: number): [number, number, number, number] {
  if (!lastSegLut) {
    throw new Error("no seg LUT was forwarded to the viewer");
  }
  const off = index * 4;
  return [lastSegLut[off], lastSegLut[off + 1], lastSegLut[off + 2], lastSegLut[off + 3]];
}

// Mock the API module so the atlas catalog fetch is deterministic and never
// hits the network. apiUrl is kept real because the component builds image/
// volume URLs with it.
const ATLAS_REGIONS: AtlasRegion[] = [
  { key: "hippocampus", name: "Hippocampus", group: "Medial temporal", labels: [17, 53] },
  { key: "amygdala", name: "Amygdala", group: "Medial temporal", labels: [18, 54] },
  { key: "thalamus", name: "Thalamus", group: "Deep grey matter", labels: [9, 10, 48, 49] },
];

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    getAtlasRegions: vi.fn(),
  };
});

import { getAtlasRegions } from "../lib/api";
import { BASE_ALPHA, REGION_ALPHA, hexToRgb } from "../lib/segLut";
import { ResultsCanvas } from "./ResultsCanvas";

beforeEach(() => {
  lastSegLut = null;
  vi.mocked(getAtlasRegions).mockResolvedValue({ maxLabel: 2035, regions: ATLAS_REGIONS });
});

const idleProgress: RunProgress = {
  state: "idle",
  percent: 0,
  label: "No run",
  detail: "Progress appears after analysis starts.",
  currentFile: null,
  counts: null,
};

const report: ReportDetail = {
  id: "report-1",
  summary: {
    id: "report-1",
    name: "brain_volumes_test.xlsx",
    outputDir: "outputs/demo",
    reportPath: "outputs/demo/reports/brain_volumes_test.xlsx",
    modified: 0,
    source: "saved",
    temporary: false,
  },
  metadata: {
    modified: 1780600000,
    source: "saved",
    inputDir: "data/tutorial",
    outputDir: "outputs/demo",
    reportPath: "outputs/demo/reports/brain_volumes_test.xlsx",
    device: null,
    runState: null,
    runId: null,
    temporary: false,
  },
  scan: {
    subject: "140_orig",
    filename: "140_orig",
    spacing: "1 x 1 x 1 mm",
  },
  rows: [
    {
      filename: "140_orig.nii.gz",
      path: "data/tutorial/140_orig.nii.gz",
      subject_id: "140_orig",
      input_spacing_mm: "1 x 1 x 1",
      segmentation_spacing_mm: "1 x 1 x 1",
      voxel_count: 1232000,
      volume_mm3: 1232000,
      volume_ml: 1232,
      status: "ok",
      error: "",
    },
  ],
  metrics: [],
  structures: [
    {
      structure: "Hippocampus",
      group: "Medial temporal",
      leftMl: 4.13,
      rightMl: 4.45,
      totalMl: 8.58,
      asymmetryPct: -7.3,
    },
  ],
  qc: [
    {
      subject: "140_orig",
      filename: "140_orig",
      status: "ok",
      color: null,
      anat: null,
      seg: null,
    },
  ],
  artifacts: {
    xlsx: "/api/reports/report-1/download/xlsx",
    pdf: "/api/reports/report-1/download/pdf",
    color: null,
  },
};

afterEach(() => {
  vi.useRealTimers();
});

const MODE_LABEL: Record<ViewerMode, string> = { montage: "Montage", slices: "Slices", "3d": "3D" };
const MODE_ORDER: ViewerMode[] = ["montage", "slices", "3d"];

// Mirrors how App.tsx lifts the viewer mode and hosts the Montage/Slices/3D
// buttons in the far-left panel (SetupPanel): the buttons only show while the
// segmentation view is open, Slices/3D disable without a volume, clicking sets
// the mode, and ResultsCanvas drives the auto-flip back through
// onViewerModeChange. This lets the integration tests click the *relocated*
// buttons and watch the viewer react, exactly as the real two-component wiring
// does — without re-rendering the production SetupPanel here.
function ControlledCanvas({ report }: { report: ReportDetail | null }) {
  const [mode, setMode] = useState<ViewerMode>("montage");
  const [ctx, setCtx] = useState<{ inSegView: boolean; hasVolume: boolean }>({ inSegView: false, hasVolume: false });
  return (
    <>
      {ctx.inSegView ? (
        <div role="group" aria-label="Viewer mode">
          {MODE_ORDER.map((m) => {
            const disabled = m !== "montage" && !ctx.hasVolume;
            return (
              <button
                key={m}
                type="button"
                aria-label={MODE_LABEL[m]}
                aria-pressed={mode === m}
                disabled={disabled}
                onClick={() => setMode(m)}
              >
                {MODE_LABEL[m]}
              </button>
            );
          })}
        </div>
      ) : null}
      <ResultsCanvas
        report={report}
        runProgress={idleProgress}
        isRunning={false}
        viewerMode={mode}
        onViewerModeChange={setMode}
        onViewerContextChange={setCtx}
      />
    </>
  );
}

describe("ResultsCanvas", () => {
  it("renders report rows as the primary result table", () => {
    render(<ResultsCanvas report={report} runProgress={idleProgress} isRunning={false} />);

    expect(screen.getByRole("progressbar", { name: /run progress/i })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Analyzed")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("data/tutorial")).toBeInTheDocument();
    expect(screen.getAllByText("outputs/demo").length).toBeGreaterThan(0);
    expect(screen.getByText("Scan results")).toBeInTheDocument();
    expect(screen.getByText("140_orig.nii.gz")).toBeInTheDocument();
    expect(screen.getByText("1,232")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("renders the empty canvas when no report is loaded", () => {
    render(<ResultsCanvas report={null} runProgress={idleProgress} isRunning={false} />);

    expect(screen.getByText("No result loaded")).toBeInTheDocument();
  });

  it("renders active run progress with the current file and gradient meter", () => {
    render(
      <ResultsCanvas
        report={null}
        runProgress={{
          state: "running",
          percent: 42,
          label: "Segmenting scan",
          detail: "FastSurfer segmentation in progress.",
          currentFile: "scan-a.nii.gz",
          counts: "1 of 3 scans",
        }}
        isRunning
      />,
    );

    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /run progress/i })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("progressbar", { name: /run progress/i })).toHaveAttribute("aria-valuetext", "Segmenting scan: scan-a.nii.gz");
  });

  it("eases progress toward new backend event targets instead of jumping", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const queued: RunProgress = {
      state: "queued",
      percent: 2,
      label: "Queued",
      detail: "Starting worker.",
      currentFile: null,
      counts: null,
    };
    const segmenting: RunProgress = {
      state: "running",
      percent: 18,
      label: "Segmenting scan",
      detail: "FastSurfer segmentation in progress.",
      currentFile: "scan-a.nii.gz",
      counts: "1 of 1 scans",
    };
    const { rerender } = render(<ResultsCanvas report={null} runProgress={queued} isRunning />);

    rerender(<ResultsCanvas report={null} runProgress={segmenting} isRunning />);
    expect(screen.getByRole("progressbar", { name: /run progress/i })).toHaveAttribute("aria-valuenow", "2");

    act(() => {
      vi.advanceTimersByTime(120);
    });

    const value = Number(screen.getByRole("progressbar", { name: /run progress/i }).getAttribute("aria-valuenow"));
    expect(value).toBeGreaterThan(2);
    expect(value).toBeLessThan(18);
  });

  it("keeps estimating long segmentation progress below completion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    render(
      <ResultsCanvas
        report={null}
        runProgress={{
          state: "running",
          percent: 18,
          label: "Segmenting scan",
          detail: "FastSurfer segmentation in progress.",
          currentFile: "scan-a.nii.gz",
          counts: "1 of 1 scans",
        }}
        isRunning
      />,
    );

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    const value = Number(screen.getByRole("progressbar", { name: /run progress/i }).getAttribute("aria-valuenow"));
    expect(value).toBeGreaterThan(30);
    expect(value).toBeLessThan(82);
  });

  it("renders stationary advanced structure headers outside the scroll body", () => {
    render(<ResultsCanvas report={report} runProgress={idleProgress} isRunning={false} />);

    const structureHeader = screen.getByRole("columnheader", { name: "Structure" });
    expect(structureHeader.closest(".structure-volume-header")).not.toBeNull();
    expect(screen.getByRole("cell", { name: "Hippocampus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Structures" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches between structure rows and QC images instead of showing both", () => {
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [{ subject: "140_orig", filename: "140_orig", status: "ok", color: "/api/reports/report-1/qc/140_orig", anat: null, seg: null }],
        }}
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    expect(screen.queryByAltText("Segmentation overlay for 140_orig")).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Hippocampus" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    expect(screen.getByAltText("Segmentation overlay for 140_orig")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Hippocampus" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Segmentation check" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets you scroll QC across multiple scans", () => {
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            { subject: "sub-01", filename: "sub-01", status: "ok", color: "/api/reports/report-1/qc/sub-01", anat: null, seg: null },
            { subject: "sub-02", filename: "sub-02", status: "ok", color: "/api/reports/report-1/qc/sub-02", anat: null, seg: null },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    // Defaults to the first scan with an image.
    expect(screen.getByAltText("Segmentation overlay for sub-01")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    // Next advances to the second scan.
    fireEvent.click(screen.getByRole("button", { name: /next scan/i }));
    expect(screen.getByAltText("Segmentation overlay for sub-02")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    // Jump back via the dropdown.
    fireEvent.change(screen.getByRole("combobox", { name: /scan to review/i }), { target: { value: "0" } });
    expect(screen.getByAltText("Segmentation overlay for sub-01")).toBeInTheDocument();
  });

  it("enables Slices/3D and forwards volume URLs when the scan has anat data", () => {
    render(
      <ControlledCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "140_orig",
              filename: "140_orig",
              status: "ok",
              color: "/api/reports/report-1/qc/140_orig",
              anat: "/api/reports/report-1/volume/140_orig/orig.mgz",
              seg: "/api/reports/report-1/volume/140_orig/seg.mgz",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    // With a volume available the relocated buttons default to the interactive
    // Slices view (ResultsCanvas auto-flips the parent's mode on entry).
    const slices = screen.getByRole("button", { name: "Slices" });
    const threeD = screen.getByRole("button", { name: "3D" });
    const montage = screen.getByRole("button", { name: "Montage" });
    expect(slices).toBeEnabled();
    expect(threeD).toBeEnabled();
    expect(montage).toBeEnabled();

    // The (mocked) viewer is mounted with the forwarded anat/seg URLs.
    const viewer = screen.getByTestId("volume-viewer");
    expect(viewer).toHaveAttribute("data-anat", "/api/reports/report-1/volume/140_orig/orig.mgz");
    expect(viewer).toHaveAttribute("data-seg", "/api/reports/report-1/volume/140_orig/seg.mgz");
    expect(viewer).toHaveAttribute("data-mode", "slices");
    expect(screen.queryByAltText("Segmentation overlay for 140_orig")).not.toBeInTheDocument();

    // Switching to 3D forwards the render mode to the viewer.
    fireEvent.click(threeD);
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-mode", "3d");

    // Clicking Montage swaps the viewer for the static overlay image.
    fireEvent.click(montage);
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.getByAltText("Segmentation overlay for 140_orig")).toBeInTheDocument();
  });

  it("disables Slices/3D and shows the montage when the scan has no anat data", () => {
    render(
      <ControlledCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "140_orig",
              filename: "140_orig",
              status: "ok",
              color: "/api/reports/report-1/qc/140_orig",
              anat: null,
              seg: null,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeDisabled();
    // Falls back to the static montage, never mounting the volume viewer.
    expect(screen.getByAltText("Segmentation overlay for 140_orig")).toBeInTheDocument();
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
  });

  it("renders the montage for an old report whose qc entries lack volume URLs", () => {
    // Older reports were generated before anat/seg volumes were exported, so
    // anat/seg are null but a color montage is still on disk.
    render(
      <ControlledCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "legacy-01",
              filename: "legacy-01",
              status: "ok",
              color: "/api/reports/report-1/qc/legacy-01",
              anat: null,
              seg: null,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    expect(screen.getByAltText("Segmentation overlay for legacy-01")).toBeInTheDocument();
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeDisabled();
  });

  it("auto-flips the viewer mode when navigating between volume and non-volume scans", () => {
    render(
      <ControlledCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "vol-01",
              filename: "vol-01",
              status: "ok",
              color: "/api/reports/report-1/qc/vol-01",
              anat: "/api/reports/report-1/volume/vol-01/anat",
              seg: "/api/reports/report-1/volume/vol-01/seg",
            },
            {
              subject: "novol-02",
              filename: "novol-02",
              status: "ok",
              color: "/api/reports/report-1/qc/novol-02",
              anat: null,
              seg: null,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    // Scan A has a volume: defaults to the interactive Slices view.
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-mode", "slices");
    expect(screen.getByRole("button", { name: "Slices" })).toBeEnabled();

    // Next -> scan B has no anat: mode snaps back to montage, Slices/3D disabled.
    fireEvent.click(screen.getByRole("button", { name: /next scan/i }));
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.getByAltText("Segmentation overlay for novol-02")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeDisabled();

    // Prev -> back to scan A: restores the volume view.
    fireEvent.click(screen.getByRole("button", { name: /previous scan/i }));
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-mode", "slices");
    expect(screen.getByRole("button", { name: "Slices" })).toBeEnabled();
  });

  it("forwards a null seg URL while still mounting the viewer for an anat-only scan", () => {
    render(
      <ControlledCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "anatonly-01",
              filename: "anatonly-01",
              status: "ok",
              color: "/api/reports/report-1/qc/anatonly-01",
              anat: "/api/reports/report-1/volume/anatonly-01/anat",
              seg: null,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    const viewer = screen.getByTestId("volume-viewer");
    expect(viewer).toHaveAttribute("data-anat", "/api/reports/report-1/volume/anatonly-01/anat");
    expect(viewer).toHaveAttribute("data-seg", "");
    expect(screen.getByRole("button", { name: "Slices" })).toBeEnabled();
  });

  it("reports the segmentation-view context up so the relocated mode buttons can react", () => {
    const onViewerContextChange = vi.fn();
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "140_orig",
              filename: "140_orig",
              status: "ok",
              color: "/api/reports/report-1/qc/140_orig",
              anat: "/api/reports/report-1/volume/140_orig/orig.mgz",
              seg: "/api/reports/report-1/volume/140_orig/seg.mgz",
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
        onViewerContextChange={onViewerContextChange}
      />,
    );

    // While the structures table is showing, the viewer is not on screen yet,
    // but the scan's volume is already known to the parent panel.
    expect(onViewerContextChange).toHaveBeenLastCalledWith({ inSegView: false, hasVolume: true });

    // Entering the segmentation check surfaces the viewer.
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    expect(onViewerContextChange).toHaveBeenLastCalledWith({ inSegView: true, hasVolume: true });
  });

  it("reports hasVolume:false for a report whose scan has no anat volume", () => {
    const onViewerContextChange = vi.fn();
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "legacy-01",
              filename: "legacy-01",
              status: "ok",
              color: "/api/reports/report-1/qc/legacy-01",
              anat: null,
              seg: null,
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
        onViewerContextChange={onViewerContextChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    expect(onViewerContextChange).toHaveBeenLastCalledWith({ inSegView: true, hasVolume: false });
  });

  it("asks the parent to default to slices for a volume scan and montage without one", () => {
    const onViewerModeChange = vi.fn();
    const { rerender } = render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "vol-01",
              filename: "vol-01",
              status: "ok",
              color: "/api/reports/report-1/qc/vol-01",
              anat: "/api/reports/report-1/volume/vol-01/anat",
              seg: "/api/reports/report-1/volume/vol-01/seg",
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
        onViewerModeChange={onViewerModeChange}
      />,
    );

    // A volume scan asks the parent to default to the interactive Slices view.
    expect(onViewerModeChange).toHaveBeenLastCalledWith("slices");

    // Swapping in a report whose scan has no volume flips the request to montage.
    rerender(
      <ResultsCanvas
        report={{
          ...report,
          id: "report-2",
          qc: [
            {
              subject: "novol-02",
              filename: "novol-02",
              status: "ok",
              color: "/api/reports/report-1/qc/novol-02",
              anat: null,
              seg: null,
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
        onViewerModeChange={onViewerModeChange}
      />,
    );
    expect(onViewerModeChange).toHaveBeenLastCalledWith("montage");
  });

  it("shows the no-image empty panel without the failure note for an ok scan missing its montage", () => {
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "noimg-01",
              filename: "noimg-01",
              status: "ok",
              color: null,
              anat: null,
              seg: null,
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    expect(screen.getByText("No segmentation image is available for noimg-01.")).toBeInTheDocument();
    expect(screen.queryByText(/this scan failed/i)).not.toBeInTheDocument();
  });

  it("shows the empty state for a failed scan that produced no segmentation image", () => {
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "broken-01",
              filename: "broken-01",
              status: "error",
              color: null,
              anat: null,
              seg: null,
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    expect(screen.queryByAltText(/Segmentation overlay for broken-01/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.getByText(/this scan failed/i)).toBeInTheDocument();
  });

  // A QC scan with both volume URLs, used by the region-menu tests below.
  const volumeReport: ReportDetail = {
    ...report,
    qc: [
      {
        subject: "140_orig",
        filename: "140_orig",
        status: "ok",
        color: "/api/reports/report-1/qc/140_orig",
        anat: "/api/reports/report-1/volume/140_orig/orig.mgz",
        seg: "/api/reports/report-1/volume/140_orig/seg.mgz",
      },
    ],
  };

  it("passes a full-length seg LUT to the viewer once the catalog loads", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());
    // LUT covers every label 0..2035: (2035 + 1) * 4 bytes.
    await waitFor(() =>
      expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-seglut-len", String((2035 + 1) * 4)),
    );
  });

  it("shows the Regions menu in Slices/3D and lets you pick a region color", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    // The toggle only appears once the catalog resolved.
    const toggle = await screen.findByRole("button", { name: "Regions" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Opening the panel reveals the whole-brain color and grouped region rows.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Whole-brain color")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset to one color/i })).toBeInTheDocument();
    const hippoCheck = screen.getByRole("checkbox", { name: "Show Hippocampus" });
    expect(hippoCheck).not.toBeChecked();

    // Toggling a region on flips its checkbox (and rebuilds the LUT under it).
    fireEvent.click(hippoCheck);
    expect(hippoCheck).toBeChecked();
    expect(screen.getByLabelText("Hippocampus color")).toBeInTheDocument();
  });

  it("recolors the hippocampus labels (17, 53) in the forwarded LUT when toggled on with a chosen color", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // Before any selection the whole brain is one base color: label 17 sits at
    // the base color + BASE_ALPHA, never transparent.
    await waitFor(() => expect(lastSegLut).not.toBeNull());
    const baseAt17 = lutRgba(17);
    expect(baseAt17[3]).toBe(BASE_ALPHA);

    // Pick an explicit hippocampus color, then switch the region on.
    const chosen = "#ff8800";
    const [cr, cg, cb] = hexToRgb(chosen);
    fireEvent.change(screen.getByLabelText("Hippocampus color"), { target: { value: chosen } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Hippocampus" }));

    // Both hippocampus labels (17 = left, 53 = right) become the chosen color at
    // REGION_ALPHA (the "selected region" alpha marker — the atlas shader
    // binarizes alpha, so this distinguishes region from base by tag, not GPU
    // opacity) in the LUT the component forwards to NiiVue.
    await waitFor(() => expect(lutRgba(17)).toEqual([cr, cg, cb, REGION_ALPHA]));
    expect(lutRgba(53)).toEqual([cr, cg, cb, REGION_ALPHA]);
    // A neighboring non-selected label (16 = brainstem) keeps the base color.
    expect(lutRgba(16)).toEqual(baseAt17);
    // No gaps: index 17 never went transparent.
    expect(lutRgba(17)[3]).not.toBe(0);
  });

  it("repaints the whole brain in the chosen base color and updates the forwarded LUT", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));
    await waitFor(() => expect(lastSegLut).not.toBeNull());

    const base = "#11aa44";
    const [br, bg, bb] = hexToRgb(base);
    fireEvent.change(screen.getByLabelText("Whole-brain color"), { target: { value: base } });

    // Every non-background label (17 here, plus the cortex endpoints) takes the
    // new base color at BASE_ALPHA, and index 0 stays fully transparent.
    await waitFor(() => expect(lutRgba(17)).toEqual([br, bg, bb, BASE_ALPHA]));
    expect(lutRgba(2035)).toEqual([br, bg, bb, BASE_ALPHA]);
    expect(lutRgba(0)).toEqual([0, 0, 0, 0]);
  });

  it("restores the single base color when Reset to one color is clicked", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));
    await waitFor(() => expect(lastSegLut).not.toBeNull());
    const baseAt17 = lutRgba(17);

    // Turn the hippocampus on so label 17 is repainted, then reset.
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Hippocampus" }));
    await waitFor(() => expect(lutRgba(17)[3]).toBe(REGION_ALPHA));

    fireEvent.click(screen.getByRole("button", { name: /reset to one color/i }));

    // Reset clears the selection: label 17 falls back to the base color and the
    // checkbox unticks.
    await waitFor(() => expect(lutRgba(17)).toEqual(baseAt17));
    expect(screen.getByRole("checkbox", { name: "Show Hippocampus" })).not.toBeChecked();
  });

  it("hides the Regions menu when the scan has no anat volume", async () => {
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "legacy-01",
              filename: "legacy-01",
              status: "ok",
              color: "/api/reports/report-1/qc/legacy-01",
              anat: null,
              seg: null,
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());

    // No anat => the static montage renders and the region menu never appears,
    // even though the catalog loaded fine.
    expect(screen.getByAltText("Segmentation overlay for legacy-01")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regions" })).not.toBeInTheDocument();
  });

  it("hides the Regions menu in Montage mode", async () => {
    render(<ControlledCanvas report={volumeReport} />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    await screen.findByRole("button", { name: "Regions" });

    fireEvent.click(screen.getByRole("button", { name: "Montage" }));
    expect(screen.queryByRole("button", { name: "Regions" })).not.toBeInTheDocument();
  });

  it("falls back to a working viewer with no menu when the atlas catalog fails", async () => {
    vi.mocked(getAtlasRegions).mockRejectedValueOnce(new Error("offline"));

    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());

    // The viewer still mounts and still receives a base-color-only LUT, but the
    // region menu never appears.
    const viewer = screen.getByTestId("volume-viewer");
    expect(viewer).toHaveAttribute("data-seglut-len", String((2035 + 1) * 4));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Regions" })).not.toBeInTheDocument());
  });

  it("still builds a full-length LUT when the API returns maxLabel 0 (fallback to SEG_MAX_LABEL)", async () => {
    // A 0/undefined maxLabel from the API must not shrink the LUT; the component
    // falls back to SEG_MAX_LABEL so the overlay still covers every label.
    vi.mocked(getAtlasRegions).mockResolvedValueOnce({ maxLabel: 0, regions: ATLAS_REGIONS });

    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-seglut-len", String((2035 + 1) * 4)),
    );
  });

  it("wires the disclosure relationship between the Regions toggle and panel", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    const toggle = await screen.findByRole("button", { name: "Regions" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "region-panel");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The panel exists and is the element the toggle points at.
    const panel = document.getElementById("region-panel");
    expect(panel).not.toBeNull();
    expect(panel?.tagName.toLowerCase()).toBe("aside");
  });

  it("manages focus: opening focuses the panel, × and Esc close it and restore focus to the toggle", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    const toggle = await screen.findByRole("button", { name: "Regions" });
    fireEvent.click(toggle);

    // On open, focus moves into the panel (the "Regions" heading).
    const panel = document.getElementById("region-panel")!;
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

    // The × button closes the panel and returns focus to the toggle.
    fireEvent.click(screen.getByRole("button", { name: /close regions panel/i }));
    expect(document.getElementById("region-panel")).toBeNull();
    expect(document.activeElement).toBe(toggle);

    // Re-open, then Esc closes it and again restores focus to the toggle.
    fireEvent.click(toggle);
    const reopened = document.getElementById("region-panel")!;
    fireEvent.keyDown(reopened, { key: "Escape" });
    expect(document.getElementById("region-panel")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("renders regions grouped under their group <legend> headings", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // The catalog has Medial temporal (hippocampus, amygdala) + Deep grey matter
    // (thalamus); both group legends render as fieldset captions.
    expect(screen.getByText("Medial temporal")).toBeInTheDocument();
    expect(screen.getByText("Deep grey matter")).toBeInTheDocument();
  });

  it("gives adjacent regions distinct palette defaults in their color inputs", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    const hippoColor = screen.getByLabelText("Hippocampus color") as HTMLInputElement;
    const amygColor = screen.getByLabelText("Amygdala color") as HTMLInputElement;
    // Each unselected region shows a palette default, and two catalog-adjacent
    // regions never start out the same color.
    expect(hippoColor.value).toMatch(/^#[0-9a-f]{6}$/i);
    expect(amygColor.value).toMatch(/^#[0-9a-f]{6}$/i);
    expect(hippoColor.value).not.toBe(amygColor.value);
  });

  it("colors a region with its palette default when toggled on without touching the color picker", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // Read the default the picker is showing for the (second) Amygdala row.
    const amygColor = screen.getByLabelText("Amygdala color") as HTMLInputElement;
    const [dr, dg, db] = hexToRgb(amygColor.value);

    // Just flip the checkbox -- never change the color input.
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Amygdala" }));

    // Amygdala labels (18, 54) take the palette default, not the base color.
    await waitFor(() => expect(lutRgba(18)).toEqual([dr, dg, db, REGION_ALPHA]));
    expect(lutRgba(54)).toEqual([dr, dg, db, REGION_ALPHA]);
  });

  it("merges two simultaneously selected regions into the forwarded LUT with distinct colors", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} viewerMode="slices" />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    const hippoHex = "#ff8800";
    const amygHex = "#0088ff";
    const [hr, hg, hb] = hexToRgb(hippoHex);
    const [ar, ag, ab] = hexToRgb(amygHex);

    // Turn on hippocampus with one color...
    fireEvent.change(screen.getByLabelText("Hippocampus color"), { target: { value: hippoHex } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Hippocampus" }));
    // ...then amygdala with a different color, across separate interactions.
    fireEvent.change(screen.getByLabelText("Amygdala color"), { target: { value: amygHex } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Amygdala" }));

    // setRegion's {...prev, [key]: next} merge must keep BOTH selections: the
    // single forwarded LUT carries both regions' colors at their labels.
    await waitFor(() => expect(lutRgba(18)).toEqual([ar, ag, ab, REGION_ALPHA]));
    expect(lutRgba(17)).toEqual([hr, hg, hb, REGION_ALPHA]); // hippocampus L
    expect(lutRgba(53)).toEqual([hr, hg, hb, REGION_ALPHA]); // hippocampus R
    expect(lutRgba(54)).toEqual([ar, ag, ab, REGION_ALPHA]); // amygdala R
  });
});

// The ?dev-gated window.__bvViewer hook is the contract the human's browser E2E
// drives the viewer through. jsdom lets us set window.location.search, so the
// install/teardown and the getSelection/setBaseColor/setRegion/getLut surface
// are unit-testable without a real browser.
describe("ResultsCanvas dev backdoor (window.__bvViewer)", () => {
  type BvViewer = {
    getSelection: () => Record<string, { on: boolean; color: string }>;
    setBaseColor: (hex: string) => void;
    setRegion: (key: string, next: { on?: boolean; color?: string }) => void;
    getLut: () => Uint8ClampedArray | null;
  };
  const getHook = () => (window as unknown as { __bvViewer?: BvViewer }).__bvViewer;

  // Read a label's [R,G,B,A] straight off the hook's current LUT.
  const hookRgba = (index: number): [number, number, number, number] => {
    const lut = getHook()!.getLut()!;
    const off = index * 4;
    return [lut[off], lut[off + 1], lut[off + 2], lut[off + 3]];
  };

  const volReport: ReportDetail = {
    ...report,
    qc: [
      {
        subject: "140_orig",
        filename: "140_orig",
        status: "ok",
        color: "/api/reports/report-1/qc/140_orig",
        anat: "/api/reports/report-1/volume/140_orig/orig.mgz",
        seg: "/api/reports/report-1/volume/140_orig/seg.mgz",
      },
    ],
  };

  // jsdom honors history.replaceState to mutate location.search without
  // redefining the (non-configurable) window.location object.
  function setSearch(search: string) {
    window.history.replaceState({}, "", `${window.location.pathname}${search}`);
  }

  afterEach(() => {
    setSearch("");
    delete (window as unknown as { __bvViewer?: BvViewer }).__bvViewer;
  });

  it("does NOT install the hook without ?dev", async () => {
    setSearch("");
    render(<ResultsCanvas report={volReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));
    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());

    expect(getHook()).toBeUndefined();
  });

  it("installs the hook with ?dev, drives the LUT, and tears down on unmount", async () => {
    setSearch("?dev");
    const { unmount } = render(<ResultsCanvas report={volReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Segmentation check" }));

    // The hook installs once the QC viewer mounts. It is recreated on each
    // render (fresh closures), so always read it back via getHook(), never via
    // a captured reference.
    await waitFor(() => expect(getHook()).toBeDefined());

    // getLut returns the live LUT; before any edit every non-zero label is base.
    expect(getHook()!.getLut()).toBeInstanceOf(Uint8ClampedArray);
    expect(hookRgba(17)[3]).toBe(BASE_ALPHA);

    // setBaseColor repaints the whole brain -> the LUT bytes change.
    act(() => getHook()!.setBaseColor("#112233"));
    await waitFor(() => expect(hookRgba(17).slice(0, 3)).toEqual(hexToRgb("#112233")));

    // setRegion merges a partial {on, color} against the existing/default
    // selection and recolors that region's labels.
    act(() => getHook()!.setRegion("hippocampus", { on: true, color: "#ff0000" }));
    await waitFor(() => expect(hookRgba(17)).toEqual([...hexToRgb("#ff0000"), REGION_ALPHA]));
    expect(getHook()!.getSelection().hippocampus.on).toBe(true);

    // A partial {color} edit must NOT flip `on` off (merge against current).
    act(() => getHook()!.setRegion("hippocampus", { color: "#00ff00" }));
    await waitFor(() => expect(hookRgba(17)).toEqual([...hexToRgb("#00ff00"), REGION_ALPHA]));
    expect(getHook()!.getSelection().hippocampus.on).toBe(true);

    unmount();
    expect(getHook()).toBeUndefined();
  });
});
