import { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import VolumeViewer from "../VolumeViewer";
import { useAtlasCatalog } from "../../hooks/useAtlasCatalog";
import { buildSegLayers, buildSegLut, type RegionSelection } from "../../lib/segLut";
import { apiUrl } from "../../lib/api";
import { DEFAULT_BASE_COLOR } from "../../lib/regionColors";
import { RegionPanel } from "./RegionPanel";
import type { QcScan, ViewerMode } from "../../types";

export function QcViewer({
  scan,
  mode,
}: {
  scan: QcScan;
  mode: ViewerMode;
}) {
  const hasVolume = Boolean(scan.anat);

  const catalog = useAtlasCatalog();
  const [baseColor, setBaseColor] = useState(DEFAULT_BASE_COLOR);
  // Opacity of the whole-brain base overlay (0..1). Region overlays carry their
  // own opacity in `selection`.
  const [baseOpacity, setBaseOpacity] = useState(1);
  // Empty selection => whole brain rendered in the single base color.
  const [selection, setSelection] = useState<RegionSelection>({});
  const [menuOpen, setMenuOpen] = useState(false);
  // The disclosure trigger, so closing the panel (× / Esc / Reset) can return
  // focus to it instead of dropping focus to <body>.
  const regionToggleRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setMenuOpen(false);
    regionToggleRef.current?.focus();
  };

  // The seg overlay layers: a base overlay plus one overlay per selected region,
  // each with its own opacity. Always derivable (even with an empty catalog the
  // brain gets the uniform base color), so the viewer recolors regardless of
  // whether the catalog loaded.
  const segLayers = useMemo(
    () =>
      scan.seg ? buildSegLayers(catalog.regions, selection, baseColor, catalog.maxLabel, baseOpacity) : null,
    [catalog.regions, catalog.maxLabel, selection, baseColor, baseOpacity, scan.seg],
  );

  // The merged single LUT, kept ONLY for the ?dev backdoor's getLut() (the
  // browser E2E asserts colors against one flat LUT). The live viewer uses
  // segLayers; this is not passed to it.
  const segLut = useMemo(
    () => buildSegLut(catalog.regions, selection, baseColor, catalog.maxLabel),
    [catalog.regions, catalog.maxLabel, selection, baseColor],
  );

  const setRegion = (key: string, next: { on: boolean; color: string; opacity?: number }) => {
    setSelection((prev) => {
      const current = prev[key];
      return {
        ...prev,
        // Preserve any existing opacity; default to 1 when a region is first
        // turned on without an explicit opacity.
        [key]: { ...next, opacity: next.opacity ?? current?.opacity ?? 1 },
      };
    });
  };

  const resetToOneColor = () => setSelection({});

  // Developer backdoor for browser E2E (only with `?dev`): drive and assert the
  // viewer without the real WebGL surface. Mirrors the live React state so a
  // test can read the current selection / LUT and push base-color / region
  // edits. Cleaned up on unmount.
  useEffect(() => {
    if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("dev")) {
      return;
    }
    const hook = {
      getSelection: () => selection,
      setBaseColor: (hex: string) => setBaseColor(hex),
      setRegion: (key: string, next: { on?: boolean; color?: string; opacity?: number }) =>
        setSelection((prev) => {
          const current = prev[key] ?? { on: false, color: DEFAULT_BASE_COLOR, opacity: 1 };
          return {
            ...prev,
            [key]: {
              on: next.on ?? current.on,
              color: next.color ?? current.color,
              opacity: next.opacity ?? current.opacity ?? 1,
            },
          };
        }),
      setOpacity: (key: string, value: number) => {
        if (key === "base") {
          setBaseOpacity(value);
          return;
        }
        setSelection((prev) => {
          const current = prev[key] ?? { on: false, color: DEFAULT_BASE_COLOR, opacity: 1 };
          return { ...prev, [key]: { ...current, opacity: value } };
        });
      },
      getLut: (): Uint8ClampedArray | null => segLut,
      getLayers: () => segLayers?.map((l) => ({ key: l.key, opacity: l.opacity })) ?? [],
    };
    (window as unknown as { __bvViewer?: typeof hook }).__bvViewer = hook;
    return () => {
      delete (window as unknown as { __bvViewer?: typeof hook }).__bvViewer;
    };
  }, [selection, segLut, segLayers]);

  // The region menu only makes sense in the interactive Slices/3D viewer and
  // only once the catalog actually loaded.
  const showRegionMenu =
    hasVolume && Boolean(scan.anat) && catalog.status === "ready" && catalog.regions.length > 0;

  return (
    <div className="qc-viewer-shell">
      <div className="viewer-stage">
        {scan.anat ? (
          <VolumeViewer
            key={scan.subject}
            anatUrl={apiUrl(scan.anat)}
            segUrl={scan.seg ? apiUrl(scan.seg) : null}
            mode={mode === "3d" ? "3d" : "slices"}
            segLayers={segLayers}
          />
        ) : (
          <div className="empty-panel">No volume files are available for {scan.subject}.</div>
        )}
      </div>

      {showRegionMenu ? (
        <div className="viewer-region-controls">
          <button
            ref={regionToggleRef}
            type="button"
            className={`region-toggle ${menuOpen ? "active" : ""}`}
            aria-pressed={menuOpen}
            aria-expanded={menuOpen}
            aria-controls="region-panel"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>Regions</span>
          </button>
          {menuOpen ? (
            <RegionPanel
              regions={catalog.regions}
              selection={selection}
              baseColor={baseColor}
              baseOpacity={baseOpacity}
              onBaseColor={setBaseColor}
              onBaseOpacity={setBaseOpacity}
              onRegionChange={setRegion}
              onReset={resetToOneColor}
              onClose={closeMenu}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
