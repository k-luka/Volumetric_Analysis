import { useEffect, useRef, useState } from "react";
// Type-only: the runtime NiiVue module is `import()`ed lazily in the load
// effect so the ~1 MB library (plus its codec chunks) stays out of the main
// bundle — the app shell renders without it and it loads only when a volume
// view first mounts.
import type { Niivue } from "@niivue/niivue";
import { SEG_LABEL_VOLUME_NAME, SEG_MAX_LABEL, type SegLayer } from "../lib/segLut";

type VolumeViewerProps = {
  anatUrl: string;
  segUrl: string | null;
  mode: "slices" | "3d";
  // The segmentation render, split into one overlay volume per layer (see
  // buildSegLayers / the SegLayer doc). layers[0] is the BASE overlay loaded as
  // nv.volumes[1]; each later layer is a CLONE of that seg image with its own
  // colormapLabel LUT and per-overlay opacity. The split exists ONLY because
  // NiiVue's atlas shader binarizes per-label alpha, so graduated per-region
  // transparency has to come from each region's own overlay opacity, not LUT
  // alpha. When null/empty the overlay keeps whatever colors NiiVue assigned on
  // load.
  segLayers?: SegLayer[] | null;
};

// Slice scrubbers, in the left-to-right order NiiVue draws the multiplanar row
// (Axial, Coronal, Sagittal). `axis` is the index into the fractional crosshair
// position [R, A, S] (each 0..1) that this plane steps through: an axial slice
// moves along S (index 2), coronal along A (1), sagittal along R (0).
const SLICE_AXES: { label: string; axis: 0 | 1 | 2 }[] = [
  { label: "Axial", axis: 2 },
  { label: "Coronal", axis: 1 },
  { label: "Sagittal", axis: 0 },
];

// Reconcile the NiiVue overlay volumes to match `layers`.
//
// layers[0] is the BASE overlay, already loaded as nv.volumes[1]. Every later
// layer needs its OWN overlay volume (so it can carry its own per-overlay
// `opacity`, which the atlas shader applies after binarizing per-label alpha —
// see the SegLayer doc for why a single LUT cannot do graduated transparency).
// We materialize those extra overlays by CLONING the loaded base seg image:
// clone() copies the already-decoded voxel data, so adding a region overlay is a
// pure GPU/CPU copy with NO network refetch.
//
// Setting each overlay's `colormapLabel = { lut, min, max }` and calling
// updateGLVolume() rebuilds the colormap textures NiiVue uploads; those textures
// feed BOTH the multiplanar (2D) and render (3D) shaders, so one pass recolors
// every view mode. No-ops until the seg volume is actually loaded.
function reconcileSegLayers(nv: Niivue | null, layers: SegLayer[] | null | undefined): void {
  if (!nv || !nv.volumes || nv.volumes.length < 2 || !nv.volumes[1] || !layers || layers.length === 0) {
    return;
  }
  // Region overlays live at indices 2.. (index 0 = anat, index 1 = base seg).
  const desiredRegionOverlays = layers.length - 1;
  // GROW: clone the loaded base seg image for each missing region overlay.
  while (nv.volumes.length - 2 < desiredRegionOverlays) {
    const clone = nv.volumes[1].clone();
    nv.addVolume(clone);
  }
  // SHRINK: drop the trailing region overlays no longer needed.
  while (nv.volumes.length - 2 > desiredRegionOverlays) {
    nv.removeVolumeByIndex(nv.volumes.length - 1);
  }
  // Apply each layer's LUT + opacity to its overlay (base at index 1, regions
  // at 2..). Adds/removes happen above so every index now exists.
  for (let i = 0; i < layers.length; i++) {
    const v = nv.volumes[1 + i];
    v.colormapLabel = { lut: layers[i].lut, min: 0, max: SEG_MAX_LABEL };
    v.opacity = layers[i].opacity;
  }
  nv.updateGLVolume();
  nv.drawScene?.();
}

// Stable per-LUT id so the structure signature changes whenever a LUT object is
// rebuilt (a color/selection edit produces fresh Uint8ClampedArrays). A plain
// key+count signature would miss a recolor that keeps the same regions.
let lutIdSeq = 0;
const lutIds = new WeakMap<Uint8ClampedArray, number>();
function lutId(lut: Uint8ClampedArray): number {
  let id = lutIds.get(lut);
  if (id === undefined) {
    id = ++lutIdSeq;
    lutIds.set(lut, id);
  }
  return id;
}

// A signature for the LUT identity + overlay count of a layer set. When this
// changes, overlays must be added/removed and LUTs reuploaded (the heavy
// reconcile). Opacity is intentionally EXCLUDED so dragging an opacity slider
// does not trigger a full GL rebuild — it takes the cheap light-path below.
function layerStructureSignature(layers: SegLayer[] | null | undefined): string {
  if (!layers || layers.length === 0) {
    return "";
  }
  return layers.map((l) => `${l.key}:${lutId(l.lut)}`).join("|");
}

// A signature of just the opacities, for the cheap opacity-only light-path.
function layerOpacitySignature(layers: SegLayer[] | null | undefined): string {
  if (!layers || layers.length === 0) {
    return "";
  }
  return layers.map((l) => l.opacity).join(",");
}

// Apply the view mode (2D multiplanar vs 3D render) AND hide the anatomical
// volume in 3D. The anat (volumes[0]) carries the skull/scalp, which renders as
// an unsettling face mesh in the 3D volume render; in 3D we drop its opacity to
// 0 so ONLY the brain segmentation overlays render ("just the brain"). In 2D
// slices the anat is the grayscale backdrop, so it returns to full opacity.
function applyViewMode(nv: Niivue | null, mode: "slices" | "3d"): void {
  if (!nv) {
    return;
  }
  nv.setSliceType(mode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar);
  const anat = nv.volumes && nv.volumes[0];
  if (anat) {
    const want = mode === "3d" ? 0 : 1;
    // Only rebuild GL textures when the anat visibility actually changes (e.g.
    // entering/leaving 3D). In 2D the anat stays at opacity 1, so this is a
    // no-op and we avoid a needless updateGLVolume.
    if ((anat.opacity ?? 1) !== want) {
      anat.opacity = want;
      nv.updateGLVolume?.();
    }
  }
  nv.drawScene?.();
}

// Read the anatomical volume's per-axis slice counts (RAS-oriented when
// available) so each scrubber can step one slice at a time and label the
// current index. Falls back to 256 (FreeSurfer's conformed size) if the fake/
// real header isn't populated yet.
function readSliceCounts(nv: Niivue | null): [number, number, number] {
  const v = nv?.volumes?.[0] as { dims?: number[]; dimsRAS?: number[] } | undefined;
  const d = v?.dimsRAS && v.dimsRAS.length >= 4 ? v.dimsRAS : v?.dims;
  if (!d || d.length < 4) {
    return [256, 256, 256];
  }
  return [Math.round(d[1]) || 256, Math.round(d[2]) || 256, Math.round(d[3]) || 256];
}

// Read the current fractional crosshair position [R, A, S]. Defaults to the
// volume center when the scene isn't available (e.g. under test).
function readCrosshair(nv: Niivue | null): [number, number, number] {
  const cp = nv?.scene?.crosshairPos as ArrayLike<number> | undefined;
  if (!cp || cp.length < 3) {
    return [0.5, 0.5, 0.5];
  }
  return [cp[0], cp[1], cp[2]];
}

export default function VolumeViewer({ anatUrl, segUrl, mode, segLayers }: VolumeViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nvRef = useRef<Niivue | null>(null);
  const attachedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Fractional crosshair position [R, A, S] (each 0..1): the slice each plane
  // shows. The slice sliders read/write this; canvas clicks sync it back via
  // onLocationChange so the two input paths never drift.
  const [cross, setCross] = useState<[number, number, number]>([0.5, 0.5, 0.5]);
  const [sliceCounts, setSliceCounts] = useState<[number, number, number]>([256, 256, 256]);

  // Dispose the WebGL context exactly once, on true unmount. This effect has no
  // dependencies, so its cleanup only fires when the component leaves the DOM —
  // never on a URL change. The parent remounts this component per subject
  // (key={subject}) and per Montage<->Slices toggle, so each instance is
  // single-use; without cleanup() every switch abandons a live WebGL context
  // and the browser eventually force-loses the oldest ones ("Too many active
  // WebGL contexts"), leaving the canvas blank.
  useEffect(() => {
    return () => {
      nvRef.current?.cleanup?.();
      nvRef.current = null;
      attachedRef.current = false;
    };
  }, []);

  // (Re)load volumes whenever the source URLs change. A single NiiVue instance
  // is created on first run and reused across URL changes; attachToCanvas is
  // guarded by attachedRef so it runs exactly once per instance (re-attaching
  // an already-attached canvas is not a documented operation), which also keeps
  // us from leaking a second WebGL context.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        // Lazy-load the NiiVue module on first use (see the import note above).
        // Vitest's vi.mock still intercepts this dynamic specifier in tests.
        const { Niivue, MULTIPLANAR_TYPE, SHOW_RENDER } = await import("@niivue/niivue");
        if (cancelled) {
          return;
        }
        const nv = nvRef.current ?? new Niivue();
        nvRef.current = nv;
        if (!attachedRef.current) {
          await nv.attachToCanvas(canvas);
          attachedRef.current = true;
        }
        // Navigation is driven by the slice sliders below, not the crosshair, so
        // hide the (unintuitive) red crosshair lines. Force a single row of the
        // three planes — Axial | Coronal | Sagittal, no 3D tile — so the sliders
        // beneath line up one-per-plane.
        if (nv.opts) {
          nv.opts.crosshairWidth = 0;
          nv.opts.multiplanarLayout = MULTIPLANAR_TYPE.ROW;
          nv.opts.multiplanarShowRender = SHOW_RENDER.NEVER;
        }
        // Load the seg overlay PLAIN (no colormap): the per-label LUT applied
        // via colormapLabel below carries both the colors and the alpha, so the
        // overlay defaults to one uniform color over the whole brain (and lets
        // a region menu repaint individual regions) instead of NiiVue's
        // multi-color categorical "freesurfer" map. Opacity stays 1; the LUT's own
        // alpha channel decides transparent (alpha 0 -> background) vs. opaque
        // per label (the atlas shader binarizes any non-zero alpha to fully
        // opaque), and the colors are entirely the LUT's.
        //
        // The `name` MUST be one NiiVue recognizes as a FreeSurfer LABEL image,
        // not a cosmetic label. NiiVue's MGZ reader (readMgh) only sets
        // hdr.intent_code = 1002 — which makes setupVolumeTextureData select the
        // ATLAS fragment shader that does an INTEGER per-label LUT lookup — when
        // the volume name contains an entry from its hardcoded `mgLabelFiles`
        // list (substring match). Our segmentation is FastSurfer's
        // aparc.DKTatlas+aseg.deep.mgz; its MGZ version field is 1 (not 257) and
        // it has no FreeSurfer label footer, so the name is the only signal.
        // "seg.mgz" matches NONE of the entries (it does not contain "aseg.mg"),
        // which would fall back to the SCALAR shader: that samples the colormap
        // with LINEAR interpolation across the 2036-wide LUT, so a selected
        // region's color bleeds across label boundaries instead of rendering as
        // a crisp mask. Naming it "aparc.DKTatlas+aseg.deep.mgz" contains the
        // mgLabelFiles entry "aparc.DKTatlas+aseg.deep.mg", forcing the atlas
        // (integer-label) shader so each region's color is exact in BOTH 2D and
        // 3D. This `name` is purely what NiiVue inspects; it is independent of
        // the backend download filename.
        await nv.loadVolumes([
          { url: anatUrl, name: "orig.mgz" },
          ...(segUrl
            ? [
                {
                  url: segUrl,
                  name: SEG_LABEL_VOLUME_NAME,
                  opacity: 1,
                },
              ]
            : []),
        ]);
        if (cancelled) {
          return;
        }
        // Recolor (and grow/shrink the region overlays for) the freshly loaded
        // overlay before the first paint so it never flashes the default scalar
        // colors and initial region layers render immediately. The dedicated
        // effects below keep it in sync on later edits.
        reconcileSegLayers(nv, segLayers);
        applyViewMode(nv, mode === "3d" ? "3d" : "slices");
        // Seed the sliders from the loaded volume, and keep them in sync when the
        // user clicks directly on a slice (which still recenters the crosshair).
        setSliceCounts(readSliceCounts(nv));
        setCross(readCrosshair(nv));
        nv.onLocationChange = (loc: unknown) => {
          const frac = (loc as { frac?: ArrayLike<number> } | null)?.frac;
          if (frac && frac.length >= 3) {
            setCross([frac[0], frac[1], frac[2]]);
          }
        };
        setLoading(false);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load volume");
        setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // mode and segLayers are handled by their own effects; only reload when the
    // data URLs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anatUrl, segUrl]);

  // HEAVY path: when the set of layers or any LUT's identity changes (region
  // toggled on/off, color/base-color edited), add/remove the cloned region
  // overlays and reupload every LUT + opacity. Guarded so it no-ops until the
  // seg volume exists; the load effect runs the initial reconcile itself, so
  // this only handles later structural/color updates without reloading volumes.
  const structureSig = layerStructureSignature(segLayers);
  useEffect(() => {
    reconcileSegLayers(nvRef.current, segLayers);
    // segLayers identity tracks via structureSig; opacity-only changes are
    // handled by the light path below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureSig]);

  // LIGHT path: when ONLY opacities change (dragging a region/whole-brain
  // slider), just set v.opacity on the existing overlays and redraw — no
  // updateGLVolume, no clone/remove — so the drag stays smooth. The heavy effect
  // above has already created/destroyed any overlays for the current structure,
  // so indices 1.. all exist here.
  const opacitySig = layerOpacitySignature(segLayers);
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !nv.volumes || nv.volumes.length < 2 || !segLayers) {
      return;
    }
    for (let i = 0; i < segLayers.length; i++) {
      const v = nv.volumes[1 + i];
      if (v) {
        v.opacity = segLayers[i].opacity;
      }
    }
    nv.drawScene?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacitySig]);

  // Switch between multiplanar (2D) and render (3D) without reloading volumes.
  // Also toggles the anat skull/face off in 3D (see applyViewMode).
  useEffect(() => {
    applyViewMode(nvRef.current, mode === "3d" ? "3d" : "slices");
  }, [mode]);

  // Move one plane to an absolute fractional position and repaint. Mutates the
  // existing crosshair vec3 in place (preserving its Float32Array type) before
  // reassigning, so NiiVue's own math keeps working.
  const moveAxis = (axis: 0 | 1 | 2, value: number) => {
    const next: [number, number, number] = [cross[0], cross[1], cross[2]];
    next[axis] = value;
    setCross(next);
    const nv = nvRef.current;
    const cp = nv?.scene?.crosshairPos as (number[] | Float32Array) | undefined;
    if (nv && cp && cp.length >= 3) {
      cp[0] = next[0];
      cp[1] = next[1];
      cp[2] = next[2];
      nv.scene.crosshairPos = cp;
      nv.drawScene?.();
    }
  };

  // The scrubbers only make sense over the 2D multiplanar slices, once a volume
  // has actually loaded.
  const showSliders = mode === "slices" && !loading && !error;

  return (
    <div className={`volume-viewer mode-${mode}`}>
      <div className="volume-canvas-wrap">
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        {loading && (
          <div className="volume-loading" role="status" aria-live="polite">
            Loading volume…
          </div>
        )}
        {error && (
          <div className="volume-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}
      </div>
      {showSliders && (
        <div className="slice-sliders" role="group" aria-label="Slice navigation">
          {SLICE_AXES.map(({ label, axis }) => {
            const count = sliceCounts[axis];
            const frac = cross[axis];
            // The slider speaks in natural slice numbers (1..count), not the
            // 0..1 fractional crosshair, so the control is exact and assistive
            // tech announces "Slice 87 of 256" instead of "0.34".
            const index = count > 1 ? Math.min(count, Math.max(1, Math.round(frac * (count - 1)) + 1)) : 1;
            return (
              <div className="slice-slider" key={label}>
                <div className="slice-slider-head">
                  <span>{label}</span>
                  <span className="slice-slider-index">
                    {index} / {count}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={count}
                  step={1}
                  value={index}
                  aria-label={`${label} slice`}
                  aria-valuetext={`Slice ${index} of ${count}`}
                  onChange={(event) => {
                    const nextIndex = Number(event.target.value);
                    moveAxis(axis, count > 1 ? (nextIndex - 1) / (count - 1) : 0.5);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
