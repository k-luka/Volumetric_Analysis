import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import type { ReportDetail, RunProgress, ViewerMode } from "../types";
import { StructureTable } from "./results/StructureTable";
import { QcViewer } from "./results/QcViewer";
import { RunProgressInline } from "./results/RunProgressInline";

type ResultsCanvasProps = {
  report: ReportDetail | null;
  runProgress: RunProgress;
  isRunning: boolean;
};

type CenterView = "structures" | "slices" | "3d";

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

export function ResultsCanvas({ report, runProgress, isRunning }: ResultsCanvasProps) {
  const [view, setView] = useState<CenterView>("structures");
  const [selectedQc, setSelectedQc] = useState(0);

  useEffect(() => {
    setView("structures");
    const firstWithVolume = report?.qc.findIndex((scan) => scan.anat) ?? -1;
    setSelectedQc(firstWithVolume >= 0 ? firstWithVolume : 0);
  }, [report?.id]);

  const qcScans = report?.qc ?? [];
  const qcIndex = qcScans.length ? Math.min(selectedQc, qcScans.length - 1) : 0;
  const activeQc = qcScans.length ? qcScans[qcIndex] : null;
  const hasVolume = Boolean(activeQc?.anat);
  // In the non-structures branch `view` is always a render mode QcViewer accepts.
  const segMode: ViewerMode = view === "structures" ? "slices" : view;

  // Clamp the view whenever the active scan changes so switching to a scan that
  // lacks volumes never strands you on an empty view.
  useEffect(() => {
    if ((view === "slices" || view === "3d") && !hasVolume) {
      setView("structures");
    }
  }, [activeQc?.subject, hasVolume, view]);

  return (
    <section className="canvas-panel">
      <div className="canvas-topline">
        <strong>Results</strong>
        <RunProgressInline progress={runProgress} isRunning={isRunning} />
      </div>

      {!report ? (
        <div className="empty-canvas">
          {isRunning ? (
            // A run is live but no report exists yet — describe the work in
            // progress instead of telling the user to start a run.
            <div className="run-in-progress" role="status">
              <span className="run-spinner" aria-hidden="true" />
              <strong>{runProgress.label || "Analysis in progress"}</strong>
              <span>{runProgress.currentFile ?? runProgress.detail ?? "Working…"}</span>
              {runProgress.counts ? <span className="run-progress-counts">{runProgress.counts}</span> : null}
            </div>
          ) : (
            <div>
              <ImageIcon size={30} />
              <strong>No result loaded</strong>
              <span>Run analysis or open a saved report from the Reports panel.</span>
            </div>
          )}
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

          <div className="center-view-header">
            <div className="section-title">Detailed result</div>
            <div className="center-view-switch" aria-label="Detailed result view">
              <button type="button" className={view === "structures" ? "active" : ""} aria-pressed={view === "structures"} onClick={() => setView("structures")}>
                Structures
              </button>
              <button type="button" className={view === "slices" ? "active" : ""} aria-pressed={view === "slices"} disabled={!hasVolume} onClick={() => setView("slices")}>
                Slices
              </button>
              <button type="button" className={view === "3d" ? "active" : ""} aria-pressed={view === "3d"} disabled={!hasVolume} onClick={() => setView("3d")}>
                3D
              </button>
            </div>
          </div>

          <div className="center-view-panel">
            {view === "structures" ? (
              report.structures.length ? (
                <StructureTable rows={report.structures} />
              ) : (
                <div className="empty-panel">No structure table is available for this report.</div>
              )
            ) : (
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
                  <QcViewer scan={activeQc} mode={segMode} />
                ) : (
                  <div className="empty-panel">No segmentation image is available for this report.</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
