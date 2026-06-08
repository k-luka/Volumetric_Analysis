import { useEffect, useRef, useState } from "react";
import { MULTIPLANAR_TYPE, Niivue, SHOW_RENDER } from "@niivue/niivue";
import { SEG_LABEL_VOLUME_NAME, SEG_MAX_LABEL } from "../lib/segLut";

type VolumeViewerProps = {
  anatUrl: string;
  segUrl: string | null;
  mode: "slices" | "3d";
  // Flat NiiVue label LUT (Uint8ClampedArray, (SEG_MAX_LABEL+1)*4 bytes,
  // [R,G,B,A] per label id) used to recolor the segmentation overlay. When
  // null the overlay keeps whatever colors NiiVue assigned on load. The LUT
  // carries its own alpha, so the seg volume is loaded plain at opacity 1.
  segLut?: Uint8ClampedArray | null;
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

// Apply a label LUT to the segmentation overlay (nv.volumes[1]). Setting
// `colormapLabel = { lut, min, max }` and calling updateGLVolume() rebuilds the
// single colormap texture NiiVue uploads for the overlay (see
// VolumeColormap.setupColormapLabel). That texture feeds BOTH the multiplanar
// (2D slices) and render (3D) shaders, so one call recolors the overlay in
// every view mode. No-ops until the seg volume is actually loaded.
function applySegLut(nv: Niivue | null, lut: Uint8ClampedArray | null | undefined): void {
  if (!nv || !lut || !nv.volumes || nv.volumes.length < 2 || !nv.volumes[1]) {
    return;
  }
  nv.volumes[1].colormapLabel = { lut, min: 0, max: SEG_MAX_LABEL };
  nv.updateGLVolume();
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

export default function VolumeViewer({ anatUrl, segUrl, mode, segLut }: VolumeViewerProps) {
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

    const nv = nvRef.current ?? new Niivue();
    nvRef.current = nv;

    const run = async () => {
      try {
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
        // Recolor the freshly loaded overlay before the first paint so it never
        // flashes the default scalar colors. The dedicated [segLut] effect below
        // keeps it in sync on later edits.
        applySegLut(nv, segLut);
        nv.setSliceType(
          mode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar,
        );
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
    // mode and segLut are handled by their own effects; only reload when the
    // data URLs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anatUrl, segUrl]);

  // Live-recolor the segmentation overlay whenever the LUT changes (region menu
  // edits, base-color picks). Guarded so it no-ops until the seg volume exists;
  // the load effect applies the initial LUT itself, so this only handles later
  // updates without reloading any volume.
  useEffect(() => {
    applySegLut(nvRef.current, segLut);
  }, [segLut]);

  // Switch between multiplanar (2D) and render (3D) without reloading volumes.
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv) {
      return;
    }
    nv.setSliceType(mode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar);
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
    <div className="volume-viewer">
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
