import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal shape of the volume options the component passes to loadVolumes;
// typing the fake explicitly keeps the recorded call args strongly typed.
type LoadedVolume = { url: string; name?: string; colormap?: string; opacity?: number };

// Shape of the per-label LUT the component assigns to nv.volumes[1].colormapLabel.
type FakeLut = { lut: Uint8ClampedArray; min: number; max: number };

// One fake NVImage volume, just enough surface for the seg-LUT recolor path and
// the slice-count readout (dims) the scrubbers use.
type FakeVolume = { name?: string; colormapLabel: FakeLut | null; dims?: number[] };

// Records every interaction the component has with NiiVue so the tests can
// assert on attach/load/setSliceType without a real WebGL context.
const attachToCanvas = vi.fn(async (_canvas: HTMLCanvasElement) => {});
// loadVolumes populates the fake's `volumes` array so the LUT-recolor path,
// which reads nv.volumes[1], has something to operate on after a load. dims
// mimics a 256^3 conformed volume so the scrubbers report "/ 256".
const loadVolumes = vi.fn(async function (this: FakeNiivue, volumes: LoadedVolume[]) {
  this.volumes = volumes.map((v) => ({ name: v.name, colormapLabel: null, dims: [3, 256, 256, 256] }));
});
const setSliceType = vi.fn((_sliceType: string) => {});
const updateGLVolume = vi.fn(() => {});
const cleanup = vi.fn(() => {});
// Repaint hook the slice sliders call after moving the crosshair.
const drawScene = vi.fn(() => {});

// Counts how many FakeNiivue instances were constructed so a test can prove the
// component reuses a single instance across URL changes (no WebGL-context leak).
let instanceCount = 0;

// Sentinel values for the slice-type enum. They only need to be distinct so we
// can tell which branch the component took.
const SLICE_TYPE_MULTIPLANAR = "multiplanar-sentinel";
const SLICE_TYPE_RENDER = "render-sentinel";

// Minimal NiiVue instance surface the component touches. The most recently
// constructed fake is captured in `lastInstance` so tests can read back the LUT
// the component assigned to the seg overlay (nv.volumes[1].colormapLabel).
type FakeNiivue = {
  sliceTypeMultiplanar: string;
  sliceTypeRender: string;
  volumes: FakeVolume[];
  updateGLVolume: typeof updateGLVolume;
  opts: { crosshairWidth: number; multiplanarLayout: number; multiplanarShowRender: number };
  scene: { crosshairPos: number[] };
  drawScene: typeof drawScene;
  onLocationChange?: (loc: unknown) => void;
};

let lastInstance: FakeNiivue | null = null;

// The factory is hoisted above all module code, so it must build the fake class
// from values it captures lazily (inside the constructor / methods), never from
// a top-level binding declared after the mock call.
vi.mock("@niivue/niivue", () => {
  class FakeNiivueImpl {
    sliceTypeMultiplanar = SLICE_TYPE_MULTIPLANAR;
    sliceTypeRender = SLICE_TYPE_RENDER;
    volumes: FakeVolume[] = [];
    // Defaults mirror NiiVue's: a visible crosshair and AUTO layout, so the
    // component must actively flip them off/ROW to count as "hid the lines".
    opts = { crosshairWidth: 1, multiplanarLayout: 0, multiplanarShowRender: 2 };
    scene = { crosshairPos: [0.5, 0.5, 0.5] };
    attachToCanvas = attachToCanvas;
    loadVolumes = loadVolumes;
    setSliceType = setSliceType;
    updateGLVolume = updateGLVolume;
    cleanup = cleanup;
    drawScene = drawScene;
    onLocationChange: (loc: unknown) => void = () => {};
    constructor() {
      instanceCount += 1;
      lastInstance = this as unknown as FakeNiivue;
    }
  }
  return {
    Niivue: FakeNiivueImpl,
    // Mirror the real enum numeric values so the component's opts assignments
    // resolve under the mock instead of reading `.ROW` off `undefined`.
    MULTIPLANAR_TYPE: { AUTO: 0, COLUMN: 1, GRID: 2, ROW: 3 },
    SHOW_RENDER: { NEVER: 0, ALWAYS: 1, AUTO: 2 },
  };
});

// Imported after the mock is registered so the component picks up FakeNiivue.
import VolumeViewer from "./VolumeViewer";
import { SEG_LABEL_VOLUME_NAME } from "../lib/segLut";

// Build a loadVolumes mock whose promise stays pending until the returned
// resolve() is called, letting tests observe the in-flight loading state.
function deferredLoad() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const mock = vi.fn(async (_volumes: LoadedVolume[]) => promise);
  return { mock, resolve, reject };
}

beforeEach(() => {
  attachToCanvas.mockClear();
  loadVolumes.mockClear();
  setSliceType.mockClear();
  updateGLVolume.mockClear();
  cleanup.mockClear();
  drawScene.mockClear();
  instanceCount = 0;
  lastInstance = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("VolumeViewer", () => {
  it("attaches to the canvas and loads the anatomical volume on mount", async () => {
    render(<VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));

    expect(attachToCanvas).toHaveBeenCalledTimes(1);
    const loaded = loadVolumes.mock.calls[0][0];
    expect(loaded).toHaveLength(1);
    expect(loaded[0].url).toBe("/api/anat.mgz");
  });

  it("loads both anatomical and segmentation volumes when segUrl is set", async () => {
    render(<VolumeViewer anatUrl="/api/anat.mgz" segUrl="/api/seg.mgz" mode="slices" />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));

    const loaded = loadVolumes.mock.calls[0][0];
    expect(loaded).toHaveLength(2);
    expect(loaded[0].url).toBe("/api/anat.mgz");
    expect(loaded[1].url).toBe("/api/seg.mgz");
    // The overlay loads PLAIN at full opacity: no preset colormap. Colors and
    // alpha come from the per-label LUT applied via colormapLabel, so the
    // overlay can default to one uniform mask color instead of the multi-color
    // categorical "freesurfer" map.
    expect(loaded[1].opacity).toBe(1);
    expect(loaded[1].colormap).toBeUndefined();
    // The seg `name` must contain a NiiVue `mgLabelFiles` entry so readMgh sets
    // intent_code=1002 and the ATLAS (integer per-label) shader is selected; a
    // name like "seg.mgz" would fall back to the scalar shader and interpolate
    // colors across label boundaries. Assert against the single source of truth
    // and that it still carries the recognized substring.
    expect(loaded[1].name).toBe(SEG_LABEL_VOLUME_NAME);
    expect(SEG_LABEL_VOLUME_NAME).toContain("aparc.DKTatlas+aseg.deep.mg");
  });

  it("recolors the seg overlay via colormapLabel after load when a segLut is supplied", async () => {
    const lut = new Uint8ClampedArray((2035 + 1) * 4).fill(7);

    render(<VolumeViewer anatUrl="/api/anat.mgz" segUrl="/api/seg.mgz" mode="slices" segLut={lut} />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));

    // The LUT is assigned to the overlay (volumes[1]), not the anat (volumes[0]),
    // spanning the full 0..2035 label range, and a GL refresh is requested so it
    // takes effect in both multiplanar and render modes (shared colormap texture).
    await waitFor(() => expect(lastInstance?.volumes[1].colormapLabel).not.toBeNull());
    expect(lastInstance?.volumes[0].colormapLabel).toBeNull();
    const applied = lastInstance?.volumes[1].colormapLabel;
    expect(applied?.lut).toBe(lut);
    expect(applied?.min).toBe(0);
    expect(applied?.max).toBe(2035);
    expect(updateGLVolume).toHaveBeenCalled();
  });

  it("applies the LUT inside the load flow (no freesurfer-color flash) when mounted with a segLut", async () => {
    // Gate the load so we can observe the moment between loadVolumes resolving
    // and loading clearing. Until the seg volume exists, applySegLut no-ops, so
    // the prop-change [segLut] effect that also runs at mount cannot be what
    // recolors it -- only the load effect (which runs right after loadVolumes,
    // before setLoading(false)) can. This pins the no-flash recolor to the load
    // path, distinct from the prop-change re-apply covered below.
    const deferred = deferredLoad();
    loadVolumes.mockImplementationOnce(async function (this: FakeNiivue, volumes: LoadedVolume[]) {
      this.volumes = volumes.map((v) => ({ name: v.name, colormapLabel: null }));
      return deferred.mock([]);
    });
    const lut = new Uint8ClampedArray((2035 + 1) * 4).fill(5);

    const { getByRole, queryByText } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl="/api/seg.mgz" mode="slices" segLut={lut} />,
    );

    // Still loading: the overlay has not been recolored yet.
    await waitFor(() => expect(lastInstance?.volumes?.[1]).toBeTruthy());
    expect(getByRole("status")).toHaveTextContent("Loading volume");
    expect(lastInstance?.volumes[1].colormapLabel).toBeNull();
    expect(updateGLVolume).not.toHaveBeenCalled();

    deferred.resolve();

    // Once the load resolves the LUT is in place AND the loading text is gone:
    // the recolor happened within the same load cycle, before the first paint.
    await waitFor(() => expect(queryByText(/Loading volume/i)).not.toBeInTheDocument());
    expect(lastInstance?.volumes[1].colormapLabel?.lut).toBe(lut);
    expect(updateGLVolume).toHaveBeenCalled();
  });

  it("re-applies the LUT when the segLut prop changes without reloading volumes", async () => {
    const first = new Uint8ClampedArray((2035 + 1) * 4).fill(1);
    const second = new Uint8ClampedArray((2035 + 1) * 4).fill(2);

    const { rerender } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl="/api/seg.mgz" mode="slices" segLut={first} />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(lastInstance?.volumes[1].colormapLabel?.lut).toBe(first));
    updateGLVolume.mockClear();

    rerender(<VolumeViewer anatUrl="/api/anat.mgz" segUrl="/api/seg.mgz" mode="slices" segLut={second} />);

    // New LUT swapped in, GL refreshed, but no second loadVolumes call.
    await waitFor(() => expect(lastInstance?.volumes[1].colormapLabel?.lut).toBe(second));
    expect(updateGLVolume).toHaveBeenCalled();
    expect(loadVolumes).toHaveBeenCalledTimes(1);
  });

  it("does not touch colormapLabel when there is no seg overlay", async () => {
    const lut = new Uint8ClampedArray((2035 + 1) * 4).fill(9);

    render(<VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" segLut={lut} />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));

    // Only the anat volume exists; the guard must not index a missing overlay.
    expect(lastInstance?.volumes).toHaveLength(1);
    expect(lastInstance?.volumes[0].colormapLabel).toBeNull();
    expect(updateGLVolume).not.toHaveBeenCalled();
  });

  it("loads only the anatomical volume when segUrl is null", async () => {
    render(<VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));

    const loaded = loadVolumes.mock.calls[0][0];
    expect(loaded).toHaveLength(1);
  });

  it("renders multiplanar slices in the default slices mode", async () => {
    render(<VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(setSliceType).toHaveBeenCalled());

    expect(setSliceType).toHaveBeenLastCalledWith(SLICE_TYPE_MULTIPLANAR);
  });

  it("switches to the render slice type when the mode prop becomes 3d", async () => {
    const { rerender } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    setSliceType.mockClear();

    rerender(<VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="3d" />);

    await waitFor(() => expect(setSliceType).toHaveBeenCalledWith(SLICE_TYPE_RENDER));
    expect(setSliceType).toHaveBeenLastCalledWith(SLICE_TYPE_RENDER);
  });

  it("shows the loading text while volumes are pending and clears it once they resolve", async () => {
    const deferred = deferredLoad();
    loadVolumes.mockImplementationOnce(deferred.mock);

    const { getByRole, queryByText } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    // The status region announces loading while the load promise is pending.
    const status = getByRole("status");
    expect(status).toHaveTextContent("Loading volume");
    expect(status).toHaveAttribute("aria-live", "polite");

    deferred.resolve();

    await waitFor(() => expect(queryByText(/Loading volume/i)).not.toBeInTheDocument());
  });

  it("renders the rejection message in an assertive alert and clears loading", async () => {
    loadVolumes.mockRejectedValueOnce(new Error("boom"));

    const { findByRole, queryByText } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    const alert = await findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(alert).toHaveClass("volume-error");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(queryByText(/Loading volume/i)).not.toBeInTheDocument();
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    loadVolumes.mockRejectedValueOnce("not-an-error");

    const { findByRole } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    const alert = await findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load volume");
  });

  it("reuses one Niivue instance across URL changes and re-loads without re-attaching", async () => {
    const { rerender } = render(
      <VolumeViewer anatUrl="/api/anat-a.mgz" segUrl={null} mode="slices" />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    expect(instanceCount).toBe(1);
    expect(attachToCanvas).toHaveBeenCalledTimes(1);

    rerender(<VolumeViewer anatUrl="/api/anat-b.mgz" segUrl={null} mode="slices" />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(2));
    // Same WebGL context: no new instance, no second attach, but new URLs loaded.
    expect(instanceCount).toBe(1);
    expect(attachToCanvas).toHaveBeenCalledTimes(1);
    expect(loadVolumes.mock.calls[1][0][0].url).toBe("/api/anat-b.mgz");
  });

  it("disposes the WebGL context on unmount", async () => {
    const { unmount } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    expect(cleanup).not.toHaveBeenCalled();

    unmount();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not update state when unmounted before the load resolves", async () => {
    const deferred = deferredLoad();
    loadVolumes.mockImplementationOnce(deferred.mock);

    const { unmount } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    setSliceType.mockClear();
    unmount();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Resolving after unmount must not drive setSliceType/setState (the
    // cancelled guard early-returns), so no act() warning is logged.
    deferred.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setSliceType).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("hides the crosshair lines and forces a single Axial|Coronal|Sagittal row in slices mode", async () => {
    render(<VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />);

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));

    // crosshairWidth 0 removes the red navigation lines; ROW + NEVER lays the
    // three planes side by side with no 3D tile, so the scrubbers below line up
    // one-per-plane.
    await waitFor(() => expect(lastInstance?.opts.crosshairWidth).toBe(0));
    expect(lastInstance?.opts.multiplanarLayout).toBe(3); // MULTIPLANAR_TYPE.ROW
    expect(lastInstance?.opts.multiplanarShowRender).toBe(0); // SHOW_RENDER.NEVER
  });

  it("renders one slice slider per plane and scrubs the crosshair on input", async () => {
    const { getByRole, getAllByRole, getByText } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));

    // Three labeled scrubbers, one per plane, replace the crosshair navigation.
    await waitFor(() => expect(getAllByRole("slider")).toHaveLength(3));
    const axial = getByRole("slider", { name: "Axial slice" });
    expect(axial).toBeInTheDocument();
    expect(getByRole("slider", { name: "Coronal slice" })).toBeInTheDocument();
    expect(getByRole("slider", { name: "Sagittal slice" })).toBeInTheDocument();
    // The slider works in natural 1..256 slice numbers (not 0..1 fractions) and
    // exposes a screen-reader value text.
    expect(axial).toHaveAttribute("max", "256");
    expect(axial).toHaveAttribute("aria-valuetext", "Slice 129 of 256");

    // Moving the Axial slider to slice 1 sets the S (index 2) component of the
    // fractional crosshair to 0, repaints, and updates the visible index —
    // without reloading volumes.
    drawScene.mockClear();
    fireEvent.change(axial, { target: { value: "1" } });
    expect(lastInstance?.scene.crosshairPos[2]).toBe(0);
    expect(getByText("1 / 256")).toBeInTheDocument();
    expect(drawScene).toHaveBeenCalled();
    expect(loadVolumes).toHaveBeenCalledTimes(1);
  });

  it("does not render slice sliders in 3d mode", async () => {
    const { queryAllByRole } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="3d" />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    expect(queryAllByRole("slider")).toHaveLength(0);
  });

  it("syncs the sliders when a canvas click moves the crosshair", async () => {
    const { getByRole } = render(
      <VolumeViewer anatUrl="/api/anat.mgz" segUrl={null} mode="slices" />,
    );

    await waitFor(() => expect(loadVolumes).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(lastInstance?.onLocationChange).toBeTypeOf("function"));

    // NiiVue reports a click as a fractional location; the Sagittal (R, index 0)
    // slider should follow it without any slider interaction. frac 0.8 over 256
    // slices => round(0.8 * 255) + 1 = slice 205.
    act(() => {
      lastInstance?.onLocationChange?.({ frac: [0.8, 0.4, 0.6] });
    });
    expect((getByRole("slider", { name: "Sagittal slice" }) as HTMLInputElement).value).toBe("205");
  });
});
