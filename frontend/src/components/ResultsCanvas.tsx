import { useEffect, useMemo, useRef, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ImageIcon, SlidersHorizontal } from "lucide-react";
import { apiUrl, getAtlasRegions } from "../lib/api";
import VolumeViewer from "./VolumeViewer";
import { SEG_MAX_LABEL, buildSegLut, type RegionSelection } from "../lib/segLut";
import type { AtlasRegion, QcScan, ReportDetail, ReportRow, RunProgress, StructureVolume, ViewerMode } from "../types";

type ResultsCanvasProps = {
  report: ReportDetail | null;
  runProgress: RunProgress;
  isRunning: boolean;
  viewerMode?: ViewerMode;
  onViewerModeChange?: (mode: ViewerMode) => void;
  onViewerContextChange?: (ctx: { inSegView: boolean; hasVolume: boolean }) => void;
};

type CenterView = "structures" | "qc";

function fmt(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function cellText(value: string | number): string {
  if (value === "" || value === null || typeof value === "undefined") {
    return "-";
  }
  if (typeof value === "number") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value;
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Date(value * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function readableSource(source: "saved" | "current_run", temporary: boolean): string {
  return temporary || source === "current_run" ? "Current run" : "Saved";
}

function valueOrDash(value: string | null): string {
  return value && value.trim() ? value : "-";
}

function ReportRowsTable({ rows }: { rows: ReportRow[] }) {
  const columns = useMemo<ColumnDef<ReportRow>[]>(
    () => [
      { accessorKey: "filename", header: "File", cell: (info) => cellText(info.getValue<string>()) },
      { accessorKey: "subject_id", header: "Subject", cell: (info) => cellText(info.getValue<string>()) },
      { accessorKey: "input_spacing_mm", header: "Input spacing", cell: (info) => cellText(info.getValue<string>()) },
      { accessorKey: "volume_ml", header: "Volume (mL)", cell: (info) => cellText(info.getValue<string | number>()) },
      { accessorKey: "status", header: "Status", cell: (info) => cellText(info.getValue<string>()) },
      { accessorKey: "error", header: "Error", cell: (info) => cellText(info.getValue<string>()) },
    ],
    [],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="table-frame report-table-frame">
      <table className="structure-table report-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StructureTable({ rows }: { rows: StructureVolume[] }) {
  return (
    <div className="structure-volume-shell" role="table" aria-label="Advanced structure volumes">
      <div className="structure-volume-header" role="rowgroup">
        <div className="structure-volume-row" role="row">
          <span role="columnheader">Structure</span>
          <span role="columnheader">Region</span>
          <span role="columnheader">Left (mL)</span>
          <span role="columnheader">Right (mL)</span>
          <span role="columnheader">Total (mL)</span>
          <span role="columnheader">Asymmetry %</span>
        </div>
      </div>
      <div className="structure-volume-body" role="rowgroup">
        {rows.map((row) => (
          <div className="structure-volume-row" role="row" key={`${row.structure}-${row.group}`}>
            <span role="cell">{row.structure}</span>
            <span role="cell">{row.group}</span>
            <span role="cell">{fmt(row.leftMl)}</span>
            <span role="cell">{fmt(row.rightMl)}</span>
            <span role="cell">{fmt(row.totalMl)}</span>
            <span role="cell">{fmt(row.asymmetryPct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Default whole-brain mask color when no regions are picked: the overlay reads
// as ONE uniform color over the whole brain.
const DEFAULT_BASE_COLOR = "#3a8bff";

// Distinct, reasonably distinguishable defaults handed to region color pickers
// in catalog order so two adjacent regions never start out the same color. The
// user can override any of them. Cycled if the catalog is longer than the list.
const REGION_COLOR_PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#f58231",
  "#911eb4",
  "#46f0f0",
  "#f032e6",
  "#bcf60c",
  "#fabebe",
  "#008080",
  "#9a6324",
  "#800000",
  "#aaffc3",
  "#808000",
  "#000075",
  "#e6beff",
];

function defaultRegionColor(index: number): string {
  return REGION_COLOR_PALETTE[index % REGION_COLOR_PALETTE.length];
}

type AtlasCatalogState = {
  regions: AtlasRegion[];
  maxLabel: number;
  status: "loading" | "ready" | "failed";
};

// Fetch the atlas region catalog once. On failure we fall back to an empty
// catalog with status "failed": the viewer still works (whole-brain single
// color via buildSegLut([], ...)), the region menu just never appears.
function useAtlasCatalog(): AtlasCatalogState {
  const [state, setState] = useState<AtlasCatalogState>({
    regions: [],
    maxLabel: SEG_MAX_LABEL,
    status: "loading",
  });

  useEffect(() => {
    let mounted = true;
    getAtlasRegions()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setState({
          regions: data.regions,
          maxLabel: data.maxLabel || SEG_MAX_LABEL,
          status: "ready",
        });
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setState({ regions: [], maxLabel: SEG_MAX_LABEL, status: "failed" });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return state;
}

function RegionPanel({
  regions,
  selection,
  baseColor,
  onBaseColor,
  onRegionChange,
  onReset,
  onClose,
}: {
  regions: AtlasRegion[];
  selection: RegionSelection;
  baseColor: string;
  onBaseColor: (hex: string) => void;
  onRegionChange: (key: string, next: { on: boolean; color: string }) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  // On open, move focus into the panel (its heading) so keyboard users land
  // inside the revealed disclosure instead of staying on the toggle. Closing
  // (× / Esc / Reset) restores focus to the toggle, handled by the caller.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Group regions by their .group, preserving catalog order within each group.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { region: AtlasRegion; index: number }[]>();
    regions.forEach((region, index) => {
      if (!byGroup.has(region.group)) {
        byGroup.set(region.group, []);
        order.push(region.group);
      }
      byGroup.get(region.group)!.push({ region, index });
    });
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
  }, [regions]);

  return (
    <aside
      id="region-panel"
      className="region-panel"
      aria-label="Segmentation regions"
      // Esc closes the panel from anywhere inside it; the caller restores focus
      // to the toggle on close.
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="region-panel-head">
        {/* tabIndex -1 so it can receive programmatic focus on open without
            entering the tab order. */}
        <strong ref={headingRef} tabIndex={-1}>
          Regions
        </strong>
        <button type="button" className="region-panel-close" aria-label="Close regions panel" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="region-base-row">
        <label className="region-color-label" htmlFor="region-base-color">
          Whole-brain color
        </label>
        <input
          id="region-base-color"
          type="color"
          className="region-color-input"
          value={baseColor}
          aria-label="Whole-brain color"
          onChange={(event) => onBaseColor(event.target.value)}
        />
      </div>
      <button type="button" className="region-reset" onClick={onReset}>
        Reset to one color
      </button>

      <div className="region-groups">
        {groups.map(({ group, items }) => (
          <fieldset className="region-group" key={group}>
            <legend>{group}</legend>
            {items.map(({ region, index }) => {
              const sel = selection[region.key];
              const on = Boolean(sel?.on);
              const color = sel?.color ?? defaultRegionColor(index);
              const checkboxId = `region-on-${region.key}`;
              const colorId = `region-color-${region.key}`;
              return (
                <div className="region-row" key={region.key}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className="region-check"
                    checked={on}
                    aria-label={`Show ${region.name}`}
                    onChange={(event) => onRegionChange(region.key, { on: event.target.checked, color })}
                  />
                  <label className="region-name" htmlFor={checkboxId}>
                    {region.name}
                  </label>
                  <input
                    id={colorId}
                    type="color"
                    className="region-color-input"
                    value={color}
                    aria-label={`${region.name} color`}
                    onChange={(event) => onRegionChange(region.key, { on, color: event.target.value })}
                  />
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
    </aside>
  );
}

function QcViewer({
  scan,
  mode,
  multiScan,
}: {
  scan: QcScan;
  mode: ViewerMode;
  multiScan: boolean;
}) {
  const hasVolume = Boolean(scan.anat);

  const catalog = useAtlasCatalog();
  const [baseColor, setBaseColor] = useState(DEFAULT_BASE_COLOR);
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

  // The seg overlay LUT. Always derivable (even with an empty catalog the brain
  // gets the uniform base color), so the viewer recolors regardless of whether
  // the catalog loaded.
  const segLut = useMemo(
    () => buildSegLut(catalog.regions, selection, baseColor, catalog.maxLabel),
    [catalog.regions, catalog.maxLabel, selection, baseColor],
  );

  const setRegion = (key: string, next: { on: boolean; color: string }) => {
    setSelection((prev) => ({ ...prev, [key]: next }));
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
      setRegion: (key: string, next: { on?: boolean; color?: string }) =>
        setSelection((prev) => {
          const current = prev[key] ?? { on: false, color: DEFAULT_BASE_COLOR };
          return {
            ...prev,
            [key]: { on: next.on ?? current.on, color: next.color ?? current.color },
          };
        }),
      getLut: (): Uint8ClampedArray | null => segLut,
    };
    (window as unknown as { __bvViewer?: typeof hook }).__bvViewer = hook;
    return () => {
      delete (window as unknown as { __bvViewer?: typeof hook }).__bvViewer;
    };
  }, [selection, segLut]);

  // The region menu only makes sense in the interactive Slices/3D viewer (not
  // the static Montage image) and only once the catalog actually loaded.
  const showRegionMenu =
    mode !== "montage" && hasVolume && Boolean(scan.anat) && catalog.status === "ready" && catalog.regions.length > 0;

  return (
    <div className="qc-viewer-shell">
      <div className="viewer-stage">
        {mode === "montage" ? (
          scan.color ? (
            <figure>
              <figcaption>Segmentation overlaid on the scan{multiScan ? ` — ${scan.subject}` : ""}</figcaption>
              <img src={apiUrl(scan.color)} alt={`Segmentation overlay for ${scan.subject}`} />
            </figure>
          ) : (
            <div className="empty-panel">
              No segmentation image is available for {scan.subject}
              {scan.status !== "ok" ? " (this scan failed)" : ""}.
            </div>
          )
        ) : scan.anat ? (
          <VolumeViewer
            key={scan.subject}
            anatUrl={apiUrl(scan.anat)}
            segUrl={scan.seg ? apiUrl(scan.seg) : null}
            mode={mode === "3d" ? "3d" : "slices"}
            segLut={scan.seg ? segLut : null}
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
              onBaseColor={setBaseColor}
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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function scanProgressCap(progress: RunProgress): number | null {
  const match = progress.counts?.match(/^(\d+) of (\d+) scans$/);
  if (!match || progress.label !== "Segmenting scan") {
    return null;
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  const scanBase = 12;
  const scanSpan = 72;
  return clampPercent(scanBase + (index / total) * scanSpan - 2);
}

function useDisplayedProgress(progress: RunProgress, isRunning: boolean): number {
  const [displayedPercent, setDisplayedPercent] = useState(() => clampPercent(progress.percent));
  const displayedRef = useRef(displayedPercent);
  const eventStartedAtRef = useRef(Date.now());
  const lastEventKeyRef = useRef("");

  useEffect(() => {
    displayedRef.current = displayedPercent;
  }, [displayedPercent]);

  useEffect(() => {
    const eventKey = `${progress.state}:${progress.label}:${progress.percent}:${progress.currentFile ?? ""}:${progress.counts ?? ""}`;
    if (eventKey !== lastEventKeyRef.current) {
      lastEventKeyRef.current = eventKey;
      eventStartedAtRef.current = Date.now();
      if (progress.state === "idle" || progress.state === "queued" || progress.percent < displayedRef.current) {
        const next = clampPercent(progress.percent);
        displayedRef.current = next;
        setDisplayedPercent(next);
      }
    }
  }, [progress]);

  useEffect(() => {
    if (!isRunning && progress.state !== "complete" && progress.state !== "error") {
      return;
    }

    const timer = window.setInterval(() => {
      const target = clampPercent(progress.percent);
      const cap = isRunning ? scanProgressCap(progress) : null;
      const elapsedMs = Date.now() - eventStartedAtRef.current;
      const estimatedTarget =
        cap !== null && cap > target
          ? target + (cap - target) * (1 - Math.exp(-elapsedMs / 45000))
          : target;
      const safeTarget = progress.state === "complete" || progress.state === "error" ? target : Math.min(estimatedTarget, 98);
      const current = displayedRef.current;
      const delta = safeTarget - current;
      const next = Math.abs(delta) < 0.15 ? safeTarget : current + delta * 0.16;
      const rounded = clampPercent(next);
      displayedRef.current = rounded;
      setDisplayedPercent(rounded);
    }, 120);

    return () => window.clearInterval(timer);
  }, [isRunning, progress]);

  return displayedPercent;
}

function RunProgressInline({ progress, isRunning }: { progress: RunProgress; isRunning: boolean }) {
  const percent = useDisplayedProgress(progress, isRunning);
  const roundedPercent = Math.round(percent);
  const label = progress.currentFile ?? progress.counts ?? progress.detail;
  return (
    <div className={`topline-progress ${progress.state}`}>
      <div
        className="topline-progress-rail"
        role="progressbar"
        aria-label="Run progress"
        aria-valuetext={`${progress.label}: ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
      >
        <span className={`topline-progress-fill ${isRunning ? "active" : ""}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="topline-progress-percent">{roundedPercent}%</span>
    </div>
  );
}

export function ResultsCanvas({ report, runProgress, isRunning, viewerMode = "montage", onViewerModeChange, onViewerContextChange }: ResultsCanvasProps) {
  const [centerView, setCenterView] = useState<CenterView>("structures");
  const [selectedQc, setSelectedQc] = useState(0);

  useEffect(() => {
    setCenterView("structures");
    const firstWithImage = report?.qc.findIndex((scan) => scan.color) ?? -1;
    setSelectedQc(firstWithImage >= 0 ? firstWithImage : 0);
  }, [report?.id]);

  const qcScans = report?.qc ?? [];
  const qcIndex = qcScans.length ? Math.min(selectedQc, qcScans.length - 1) : 0;
  const activeQc = qcScans.length ? qcScans[qcIndex] : null;
  const hasVolume = Boolean(activeQc?.anat);

  // Reset/clamp the viewer mode whenever the active subject changes: default to
  // the interactive Slices view when a volume is available, otherwise fall back
  // to the static montage (also clamps away Slices/3D for old reports without
  // volumes). The mode itself lives in the parent (App) so the far-left panel
  // can host the buttons, so we drive it through the callback.
  useEffect(() => {
    onViewerModeChange?.(hasVolume ? "slices" : "montage");
  }, [activeQc?.subject, hasVolume, onViewerModeChange]);

  // Tell the parent whether the segmentation viewer is on screen and whether the
  // current scan has volumes, so the relocated mode buttons know when to appear
  // and which to enable.
  useEffect(() => {
    onViewerContextChange?.({ inSegView: Boolean(report) && centerView === "qc", hasVolume });
  }, [report?.id, centerView, hasVolume, onViewerContextChange]);

  return (
    <section className="canvas-panel">
      <div className="canvas-topline">
        <strong>Results</strong>
        <RunProgressInline progress={runProgress} isRunning={isRunning} />
      </div>

      {!report ? (
        <div className="empty-canvas">
          <div>
            <ImageIcon size={30} />
            <strong>No result loaded</strong>
            <span>Run analysis or open a saved report from the Reports panel.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="result-meta">
            <div>
              <span>Subject</span>
              <strong>{report.scan.subject}</strong>
            </div>
            <div>
              <span>Resolution</span>
              <strong>{report.scan.spacing}</strong>
            </div>
            <div>
              <span>Report</span>
              <strong>{report.summary.name}</strong>
            </div>
            <div>
              <span>Analyzed</span>
              <strong>{formatTimestamp(report.metadata.modified)}</strong>
            </div>
            <div>
              <span>Source</span>
              <strong>{readableSource(report.metadata.source, report.metadata.temporary)}</strong>
            </div>
            <div>
              <span>Device</span>
              <strong>{valueOrDash(report.metadata.device)}</strong>
            </div>
          </div>

          <div className="report-context">
            <div>
              <span>Input folder</span>
              <strong title={valueOrDash(report.metadata.inputDir)}>{valueOrDash(report.metadata.inputDir)}</strong>
            </div>
            <div>
              <span>Results folder</span>
              <strong title={report.metadata.outputDir}>{report.metadata.outputDir}</strong>
            </div>
            <div>
              <span>Run state</span>
              <strong>{valueOrDash(report.metadata.runState)}</strong>
            </div>
          </div>

          <div className="section-title">Scan results</div>
          {report.rows.length ? <ReportRowsTable rows={report.rows} /> : <div className="empty-panel">No scan rows are available for this report.</div>}

          <div className="center-view-header">
            <div className="section-title">Detailed result</div>
            <div className="center-view-switch" aria-label="Detailed result view">
              <button type="button" className={centerView === "structures" ? "active" : ""} aria-pressed={centerView === "structures"} onClick={() => setCenterView("structures")}>
                Structures
              </button>
              <button type="button" className={centerView === "qc" ? "active" : ""} aria-pressed={centerView === "qc"} onClick={() => setCenterView("qc")}>
                Segmentation check
              </button>
            </div>
          </div>

          <div className="center-view-panel">
            {centerView === "structures" ? (
              report.structures.length ? (
                <StructureTable rows={report.structures} />
              ) : (
                <div className="empty-panel">No structure table is available for this report.</div>
              )
            ) : null}

            {centerView === "qc" ? (
              <div className="qc-panel">
                {qcScans.length > 1 ? (
                  <div className="qc-selector">
                    <button type="button" className="qc-nav" aria-label="Previous scan" disabled={qcIndex <= 0} onClick={() => setSelectedQc(Math.max(0, qcIndex - 1))}>
                      <ChevronLeft size={16} />
                    </button>
                    <select className="qc-select" aria-label="Scan to review" value={qcIndex} onChange={(event) => setSelectedQc(Number(event.target.value))}>
                      {qcScans.map((scan, index) => (
                        <option key={`${scan.subject}-${index}`} value={index}>
                          {scan.subject}
                          {scan.status !== "ok" ? " — failed" : ""}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="qc-nav" aria-label="Next scan" disabled={qcIndex >= qcScans.length - 1} onClick={() => setSelectedQc(Math.min(qcScans.length - 1, qcIndex + 1))}>
                      <ChevronRight size={16} />
                    </button>
                    <span className="qc-counter">{qcIndex + 1} / {qcScans.length}</span>
                  </div>
                ) : null}
                {activeQc ? (
                  <QcViewer
                    scan={activeQc}
                    mode={viewerMode}
                    multiScan={qcScans.length > 1}
                  />
                ) : (
                  <div className="empty-panel">No segmentation image is available for this report.</div>
                )}
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
