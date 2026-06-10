import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasRegion, ReportDetail, RunProgress } from "../types";

// Stub out the interactive NiiVue viewer so these tests never touch WebGL.
// We surface the props it receives so the rail tests can assert that the
// anatomical/segmentation URLs and mode are forwarded correctly. The viewer now
// receives `segLayers` (a base overlay + one overlay per selected region, each
// with its own opacity); the most recent value is captured in `lastSegLayers`
// so the region-menu tests can read back the exact bytes/opacities the component
// forwarded without poking through the real NiiVue surface. The exposed length
// (base layer's LUT) keeps the "full-length LUT" assertions meaningful.
type SegLayer = { key: string; lut: Uint8ClampedArray; opacity: number };
let lastSegLayers: SegLayer[] | null = null;

vi.mock("./VolumeViewer", () => ({
  default: ({
    anatUrl,
    segUrl,
    mode,
    segLayers,
  }: {
    anatUrl: string;
    segUrl: string | null;
    mode: string;
    segLayers?: SegLayer[] | null;
  }) => {
    lastSegLayers = segLayers ?? null;
    const baseLen = segLayers && segLayers.length > 0 ? segLayers[0].lut.length : 0;
    return (
      <div
        data-testid="volume-viewer"
        data-anat={anatUrl}
        data-seg={segUrl ?? ""}
        data-mode={mode}
        data-seglut-len={baseLen ? String(baseLen) : ""}
      >
        volume-viewer
      </div>
    );
  },
}));

// Read the [R, G, B, A] bytes at a label index out of the BASE layer (layer 0)
// of the most recently forwarded segLayers. The base layer paints every
// unselected label and punches selected regions transparent.
function lutRgba(index: number): [number, number, number, number] {
  if (!lastSegLayers || lastSegLayers.length === 0) {
    throw new Error("no seg layers were forwarded to the viewer");
  }
  const lut = lastSegLayers[0].lut;
  const off = index * 4;
  return [lut[off], lut[off + 1], lut[off + 2], lut[off + 3]];
}

// Read the [R, G, B, A] bytes at a label index out of a specific region's layer
// (selected regions carry their color in their OWN overlay, not the base).
function layerRgba(key: string, index: number): [number, number, number, number] {
  const layer = lastSegLayers?.find((l) => l.key === key);
  if (!layer) {
    throw new Error(`no seg layer for region "${key}" was forwarded to the viewer`);
  }
  const off = index * 4;
  return [layer.lut[off], layer.lut[off + 1], layer.lut[off + 2], layer.lut[off + 3]];
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
  lastSegLayers = null;
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

describe("ResultsCanvas", () => {
  it("renders report metadata but not the per-scan stats table (that moved to the right panel)", () => {
    render(<ResultsCanvas report={report} runProgress={idleProgress} isRunning={false} />);

    expect(screen.getByRole("progressbar", { name: /run progress/i })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Analyzed")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("data/tutorial")).toBeInTheDocument();
    expect(screen.getAllByText("outputs/demo").length).toBeGreaterThan(0);

    // The per-scan stats (file/spacing/volume/status) now live in the right-hand
    // inspector panel, not the center canvas.
    expect(screen.queryByText("Scan results")).not.toBeInTheDocument();
    expect(screen.queryByText("140_orig.nii.gz")).not.toBeInTheDocument();
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

  it("switches between structure rows and the QC viewer instead of showing both", () => {
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
      />,
    );

    // Defaults to the Structures table.
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Hippocampus" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    // The viewer replaces the table (they never show together).
    expect(screen.getByTestId("volume-viewer")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Hippocampus" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slices" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets you scroll QC across multiple scans in the Slices viewer", () => {
    render(
      <ResultsCanvas
        report={{
          ...report,
          qc: [
            {
              subject: "sub-01",
              filename: "sub-01",
              status: "ok",
              color: "/api/reports/report-1/qc/sub-01",
              anat: "/api/reports/report-1/volume/sub-01/orig.mgz",
              seg: "/api/reports/report-1/volume/sub-01/seg.mgz",
            },
            {
              subject: "sub-02",
              filename: "sub-02",
              status: "ok",
              color: "/api/reports/report-1/qc/sub-02",
              anat: "/api/reports/report-1/volume/sub-02/orig.mgz",
              seg: "/api/reports/report-1/volume/sub-02/seg.mgz",
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    // Defaults to the first scan with a volume.
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute(
      "data-anat",
      "/api/reports/report-1/volume/sub-01/orig.mgz",
    );
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    // Next advances to the second scan's volume.
    fireEvent.click(screen.getByRole("button", { name: /next scan/i }));
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute(
      "data-anat",
      "/api/reports/report-1/volume/sub-02/orig.mgz",
    );
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    // Jump back via the dropdown.
    fireEvent.change(screen.getByRole("combobox", { name: /scan to review/i }), { target: { value: "0" } });
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute(
      "data-anat",
      "/api/reports/report-1/volume/sub-01/orig.mgz",
    );
  });

  it("enables Slices/3D and forwards volume URLs when the scan has anat data", () => {
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
      />,
    );

    const slices = screen.getByRole("button", { name: "Slices" });
    const threeD = screen.getByRole("button", { name: "3D" });
    expect(slices).toBeEnabled();
    expect(threeD).toBeEnabled();

    // Entering Slices mounts the interactive viewer with the forwarded URLs.
    fireEvent.click(slices);
    const viewer = screen.getByTestId("volume-viewer");
    expect(viewer).toHaveAttribute("data-anat", "/api/reports/report-1/volume/140_orig/orig.mgz");
    expect(viewer).toHaveAttribute("data-seg", "/api/reports/report-1/volume/140_orig/seg.mgz");
    expect(viewer).toHaveAttribute("data-mode", "slices");

    // Switching to 3D forwards the render mode to the viewer.
    fireEvent.click(threeD);
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-mode", "3d");
  });

  it("shows only Structures when the scan has no anat data", () => {
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
              anat: null,
              seg: null,
            },
          ],
        }}
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeDisabled();

    // With no volume the only available view is the Structures table — no image
    // view exists anymore.
    expect(screen.getByRole("cell", { name: "Hippocampus" })).toBeInTheDocument();
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Segmentation overlay for 140_orig")).not.toBeInTheDocument();
  });

  it("clamps to Structures when navigating from a volume scan to a non-volume scan", () => {
    render(
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
      />,
    );

    // Scan A has a volume: enter the interactive Slices view.
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-mode", "slices");
    expect(screen.getByRole("button", { name: "Slices" })).toBeEnabled();

    // Next -> scan B has no anat: the view clamps back to the Structures table
    // and Slices/3D disable. (The scan nav lives in the QC panel, so it is no
    // longer rendered once we fall back to the Structures table.)
    fireEvent.click(screen.getByRole("button", { name: /next scan/i }));
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Structures" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /next scan/i })).not.toBeInTheDocument();
  });

  it("forwards a null seg URL while still mounting the viewer for an anat-only scan", () => {
    render(
      <ResultsCanvas
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
        runProgress={idleProgress}
        isRunning={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Slices" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    const viewer = screen.getByTestId("volume-viewer");
    expect(viewer).toHaveAttribute("data-anat", "/api/reports/report-1/volume/anatonly-01/anat");
    expect(viewer).toHaveAttribute("data-seg", "");
  });

  it("disables Slices/3D in the unified control for a scan with no anat volume", () => {
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

    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeDisabled();
  });

  it("disables every seg view and stays on the structures table for a failed scan with no outputs", () => {
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

    // A failed scan produced no volume, so the unified control offers no seg
    // view and the table stays selected.
    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "3D" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Structures" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("volume-viewer")).not.toBeInTheDocument();
    expect(screen.queryByAltText(/Segmentation overlay for broken-01/)).not.toBeInTheDocument();
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
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());
    // LUT covers every label 0..2035: (2035 + 1) * 4 bytes.
    await waitFor(() =>
      expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-seglut-len", String((2035 + 1) * 4)),
    );
  });

  it("shows the Regions menu in Slices/3D and lets you pick a region color", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    // The toggle only appears once the catalog resolved.
    const toggle = await screen.findByRole("button", { name: "Regions" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Opening the panel reveals the whole-brain color trigger and grouped rows.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Edit Whole-brain color" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset to one color/i })).toBeInTheDocument();
    const hippoCheck = screen.getByRole("checkbox", { name: "Show Hippocampus" });
    expect(hippoCheck).not.toBeChecked();

    // Toggling a region on flips its checkbox (and rebuilds the LUT under it).
    fireEvent.click(hippoCheck);
    expect(hippoCheck).toBeChecked();
    expect(screen.getByRole("button", { name: "Edit Hippocampus color" })).toBeInTheDocument();
  });

  it("opens a color-picker dialog from the trigger and closes it on Escape", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    const trigger = screen.getByRole("button", { name: "Edit Hippocampus color" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Hippocampus color" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Hippocampus color" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Hippocampus color" })).not.toBeInTheDocument();
  });

  it("recolors the hippocampus labels (17, 53) in its own layer when toggled on with a chosen color", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // Before any selection the whole brain is one base color: label 17 sits at
    // the base color + BASE_ALPHA in the base layer, never transparent.
    await waitFor(() => expect(lastSegLayers).not.toBeNull());
    const baseAt17 = lutRgba(17);
    expect(baseAt17[3]).toBe(BASE_ALPHA);

    // Picking an explicit hippocampus color turns the region ON (intent to
    // highlight it) — no separate checkbox click needed.
    const chosen = "#ff8800";
    const [cr, cg, cb] = hexToRgb(chosen);
    fireEvent.click(screen.getByRole("button", { name: "Edit Hippocampus color" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Hippocampus color" }), { target: { value: chosen } });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Show Hippocampus" })).toBeChecked());

    // The region's color now lives in its OWN overlay layer (so it can have its
    // own opacity): both hippocampus labels (17 = left, 53 = right) become the
    // chosen color at REGION_ALPHA there.
    await waitFor(() => expect(layerRgba("hippocampus", 17)).toEqual([cr, cg, cb, REGION_ALPHA]));
    expect(layerRgba("hippocampus", 53)).toEqual([cr, cg, cb, REGION_ALPHA]);
    // The base layer punches those labels transparent so the region overlay
    // shows through to the anatomy.
    expect(lutRgba(17)).toEqual([0, 0, 0, 0]);
    expect(lutRgba(53)).toEqual([0, 0, 0, 0]);
    // A neighboring non-selected label (16 = brainstem) keeps the base color in
    // the base layer.
    expect(lutRgba(16)).toEqual(baseAt17);
  });

  it("repaints the whole brain in the chosen base color and updates the forwarded LUT", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));
    await waitFor(() => expect(lastSegLayers).not.toBeNull());

    const base = "#11aa44";
    const [br, bg, bb] = hexToRgb(base);
    fireEvent.click(screen.getByRole("button", { name: "Edit Whole-brain color" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Whole-brain color" }), { target: { value: base } });

    // Every non-background label (17 here, plus the cortex endpoints) takes the
    // new base color at BASE_ALPHA, and index 0 stays fully transparent.
    await waitFor(() => expect(lutRgba(17)).toEqual([br, bg, bb, BASE_ALPHA]));
    expect(lutRgba(2035)).toEqual([br, bg, bb, BASE_ALPHA]);
    expect(lutRgba(0)).toEqual([0, 0, 0, 0]);
  });

  it("restores the single base color when Reset to one color is clicked", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));
    await waitFor(() => expect(lastSegLayers).not.toBeNull());
    const baseAt17 = lutRgba(17);

    // Turn the hippocampus on so it gets its own layer (and label 17 goes
    // transparent in the base layer), then reset.
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Hippocampus" }));
    await waitFor(() => expect(layerRgba("hippocampus", 17)[3]).toBe(REGION_ALPHA));

    fireEvent.click(screen.getByRole("button", { name: /reset to one color/i }));

    // Reset clears the selection: the hippocampus layer is gone (only the base
    // layer remains) and label 17 falls back to the base color; the checkbox
    // unticks.
    await waitFor(() => expect(lastSegLayers?.map((l) => l.key)).toEqual(["base"]));
    expect(lutRgba(17)).toEqual(baseAt17);
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

    // No anat => Slices/3D are disabled, the Structures table is the only view,
    // and the region menu (which lives in the QC viewer) never appears.
    expect(screen.getByRole("button", { name: "Slices" })).toBeDisabled();
    expect(screen.getByRole("cell", { name: "Hippocampus" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regions" })).not.toBeInTheDocument();
  });

  it("falls back to a working viewer with no menu when the atlas catalog fails", async () => {
    vi.mocked(getAtlasRegions).mockRejectedValueOnce(new Error("offline"));

    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

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

    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("volume-viewer")).toHaveAttribute("data-seglut-len", String((2035 + 1) * 4)),
    );
  });

  it("wires the disclosure relationship between the Regions toggle and panel", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

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
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

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
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // The catalog has Medial temporal (hippocampus, amygdala) + Deep grey matter
    // (thalamus); both group legends render as fieldset captions.
    expect(screen.getByText("Medial temporal")).toBeInTheDocument();
    expect(screen.getByText("Deep grey matter")).toBeInTheDocument();
  });

  it("gives adjacent regions distinct palette defaults in their color inputs", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // The color now lives in a popover; open each region's popover in turn and
    // read its hex input. (Opening one closes the other via outside-pointerdown.)
    fireEvent.click(screen.getByRole("button", { name: "Edit Hippocampus color" }));
    const hippoValue = (screen.getByRole("textbox", { name: "Hippocampus color" }) as HTMLInputElement).value;
    fireEvent.click(screen.getByRole("button", { name: "Edit Amygdala color" }));
    const amygValue = (screen.getByRole("textbox", { name: "Amygdala color" }) as HTMLInputElement).value;
    // Each unselected region shows a palette default, and two catalog-adjacent
    // regions never start out the same color.
    expect(hippoValue).toMatch(/^#[0-9a-f]{6}$/i);
    expect(amygValue).toMatch(/^#[0-9a-f]{6}$/i);
    expect(hippoValue).not.toBe(amygValue);
  });

  it("colors a region with its palette default when toggled on without touching the color picker", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // Read the default the picker is showing for the (second) Amygdala row.
    fireEvent.click(screen.getByRole("button", { name: "Edit Amygdala color" }));
    const amygColor = screen.getByRole("textbox", { name: "Amygdala color" }) as HTMLInputElement;
    const [dr, dg, db] = hexToRgb(amygColor.value);

    // Just flip the checkbox -- never change the color input.
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Amygdala" }));

    // Amygdala labels (18, 54) take the palette default in the amygdala layer,
    // not the base color.
    await waitFor(() => expect(layerRgba("amygdala", 18)).toEqual([dr, dg, db, REGION_ALPHA]));
    expect(layerRgba("amygdala", 54)).toEqual([dr, dg, db, REGION_ALPHA]);
  });

  it("merges two simultaneously selected regions into the forwarded LUT with distinct colors", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    const hippoHex = "#ff8800";
    const amygHex = "#0088ff";
    const [hr, hg, hb] = hexToRgb(hippoHex);
    const [ar, ag, ab] = hexToRgb(amygHex);

    // Turn on hippocampus with one color (picking a color enables the region)...
    fireEvent.click(screen.getByRole("button", { name: "Edit Hippocampus color" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Hippocampus color" }), { target: { value: hippoHex } });
    // ...then amygdala with a different color, across separate interactions.
    fireEvent.click(screen.getByRole("button", { name: "Edit Amygdala color" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amygdala color" }), { target: { value: amygHex } });

    // setRegion's merge must keep BOTH selections: each region's color appears
    // in ITS OWN layer (one overlay per region for independent opacity).
    await waitFor(() => expect(layerRgba("amygdala", 18)).toEqual([ar, ag, ab, REGION_ALPHA]));
    expect(layerRgba("hippocampus", 17)).toEqual([hr, hg, hb, REGION_ALPHA]); // hippocampus L
    expect(layerRgba("hippocampus", 53)).toEqual([hr, hg, hb, REGION_ALPHA]); // hippocampus R
    expect(layerRgba("amygdala", 54)).toEqual([ar, ag, ab, REGION_ALPHA]); // amygdala R
    // Both regions are punched transparent in the base layer.
    expect(lutRgba(17)).toEqual([0, 0, 0, 0]);
    expect(lutRgba(18)).toEqual([0, 0, 0, 0]);
  });

  it("reflects a region's opacity slider change in that layer's opacity", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    // Turn hippocampus on -> its layer appears with default opacity 1.
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Hippocampus" }));
    await waitFor(() => expect(lastSegLayers?.find((l) => l.key === "hippocampus")?.opacity).toBe(1));

    // The opacity slider now lives in the color popover; open it, then drag to
    // 40% -> the layer's opacity follows.
    fireEvent.click(screen.getByRole("button", { name: "Edit Hippocampus color" }));
    const slider = screen.getByRole("slider", { name: "Hippocampus opacity" });
    fireEvent.change(slider, { target: { value: "40" } });
    await waitFor(() => expect(lastSegLayers?.find((l) => l.key === "hippocampus")?.opacity).toBeCloseTo(0.4));
  });

  it("reflects the whole-brain opacity slider change in the base layer's opacity", async () => {
    render(<ResultsCanvas report={volumeReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    fireEvent.click(await screen.findByRole("button", { name: "Regions" }));

    await waitFor(() => expect(lastSegLayers?.[0].opacity).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Edit Whole-brain color" }));
    fireEvent.change(screen.getByRole("slider", { name: "Whole-brain opacity" }), { target: { value: "30" } });
    await waitFor(() => expect(lastSegLayers?.[0].opacity).toBeCloseTo(0.3));
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
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));
    await waitFor(() => expect(getAtlasRegions).toHaveBeenCalled());

    expect(getHook()).toBeUndefined();
  });

  it("installs the hook with ?dev, drives the LUT, and tears down on unmount", async () => {
    setSearch("?dev");
    const { unmount } = render(<ResultsCanvas report={volReport} runProgress={idleProgress} isRunning={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Slices" }));

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
