import { Fragment, useEffect, useState } from "react";
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import { Download, FileSpreadsheet, RefreshCcw, Stethoscope } from "lucide-react";
import { openDownload } from "../lib/api";
import type { ReportDetail, ReportSummary, RuntimeCheck, RuntimeReadiness, RunProgress, RunStatus } from "../types";

// Compact display of a per-scan stat: numbers get thousands separators and 2
// decimals, blanks become a dash.
function formatStat(value: string | number): string {
  if (value === "" || value === null || typeof value === "undefined") {
    return "-";
  }
  if (typeof value === "number") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value;
}

type InspectorPanelProps = {
  reports: ReportSummary[];
  activeReport: ReportDetail | null;
  runStatus: RunStatus | null;
  runProgress: RunProgress;
  logs: string[];
  runtimeChecks: RuntimeCheck[];
  runtimeReadiness: RuntimeReadiness;
  isCheckingRuntime: boolean;
  /** The currently selected compute device, shown until a run reports its real device. */
  deviceChoice?: string;
  onCheckRuntime: () => Promise<void>;
  onOpenReport: (id: string) => Promise<void>;
  onReportsRefresh: () => Promise<void>;
};

export function InspectorPanel({
  reports,
  activeReport,
  runStatus,
  runProgress,
  logs,
  runtimeChecks,
  runtimeReadiness,
  isCheckingRuntime,
  deviceChoice = "auto",
  onCheckRuntime,
  onOpenReport,
  onReportsRefresh,
}: InspectorPanelProps) {
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [openingReport, setOpeningReport] = useState(false);
  const [refreshingReports, setRefreshingReports] = useState(false);

  useEffect(() => {
    if (activeReport && reports.some((report) => report.id === activeReport.id)) {
      setSelectedReportId(activeReport.id);
      return;
    }
    if (selectedReportId && !reports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId("");
    }
  }, [activeReport, reports, selectedReportId]);

  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? null;
  const selectedKey = selectedReport ? selectedReportId : null;
  const runLogs = logs.length ? logs : (runStatus?.logs ?? []);
  const isCancelled = runStatus?.state === "cancelled" || runProgress.state === "cancelled";
  const failureMessage = runStatus?.error || (runProgress.state === "error" || runProgress.state === "cancelled" ? runProgress.detail : "");
  // `runStatus` is only fetched at terminal events, so while a run is live the
  // displayed state comes from the SSE-driven progress instead of showing "idle".
  const liveState = runStatus?.state ?? runProgress.state;

  async function handleSelectReport(id: string) {
    setSelectedReportId(id);
    if (!id) {
      return;
    }
    setOpeningReport(true);
    try {
      await onOpenReport(id);
    } finally {
      setOpeningReport(false);
    }
  }

  async function refreshReportList() {
    setRefreshingReports(true);
    try {
      await onReportsRefresh();
    } finally {
      setRefreshingReports(false);
    }
  }

  return (
    <aside className="panel inspector-panel">
      <div className="panel-title">
        <span>Reports</span>
      </div>

      <section className="panel-section">
        <div className="section-title">Saved results</div>
        <Select className="select-field" selectedKey={selectedKey} onSelectionChange={(key) => handleSelectReport(String(key))}>
          <Label>Result</Label>
          <Button className="select-trigger">
            <SelectValue>{selectedReport?.name ?? (reports.length ? "Select result" : "No reports")}</SelectValue>
          </Button>
          <Popover className="select-popover">
            <ListBox className="select-list">
              {reports.map((report) => (
                <ListBoxItem className="select-option" id={report.id} key={report.id} textValue={report.name}>
                  <span>{report.outputDir}</span>
                  <strong>{report.name}</strong>
                  <em>{report.temporary ? "Current run" : "Saved"}</em>
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
        {activeReport?.summary.temporary ? (
          <div className="inline-note">This report hasn't been saved to a results folder yet — it stays available while the app is open.</div>
        ) : null}
        <div className="report-action-row">
          <span className="report-action-hint">
            {openingReport ? "Loading…" : reports.length ? "Select a result to view it." : "No saved results yet."}
          </span>
          <Button className="icon-button" isDisabled={refreshingReports} onPress={refreshReportList} aria-label="Refresh reports">
            <RefreshCcw size={15} />
          </Button>
        </div>
      </section>

      <section className="panel-section artifact-list">
        <div className="section-title">Outputs</div>
        <button
          type="button"
          className={`artifact-row ${activeReport?.artifacts.xlsx ? "available" : ""}`}
          disabled={!activeReport?.artifacts.xlsx}
          onClick={() => openDownload(activeReport?.artifacts.xlsx ?? null)}
        >
          <FileSpreadsheet size={16} />
          <span>Download Excel</span>
          <em>{activeReport?.artifacts.xlsx ? "ready" : "missing"}</em>
        </button>
        <button
          type="button"
          className={`artifact-row ${activeReport?.artifacts.pdf ? "available" : ""}`}
          disabled={!activeReport?.artifacts.pdf}
          onClick={() => openDownload(activeReport?.artifacts.pdf ?? null)}
        >
          <Download size={16} />
          <span>Download PDF</span>
          <em>{activeReport?.artifacts.pdf ? "ready" : "missing"}</em>
        </button>
        <p className="artifact-note">View the segmentation in the Slices or 3D view above the result.</p>
      </section>

      <section className="panel-section">
        <div className="section-title">Run status</div>
        <div className={`status-card ${runProgress.state === "error" || runStatus?.state === "error" ? "error" : ""}`}>
          <span>State</span>
          <strong>{liveState}</strong>
          <span>Device</span>
          <strong>{runStatus?.device ?? deviceChoice}</strong>
        </div>
        {failureMessage ? (
          <div className="run-error-note" role="status">
            <strong>{isCancelled ? "Run cancelled" : "Run failed"}</strong>
            <span>{failureMessage}</span>
          </div>
        ) : null}
      </section>

      <section className="panel-section">
        <div className="section-title">Scan results</div>
        {!activeReport ? (
          <div className="inline-note">Open a report or run analysis to see per-scan stats.</div>
        ) : activeReport.rows.length === 0 ? (
          <div className="inline-note">No scan rows are available for this report.</div>
        ) : (
          <div className="scan-results-table" role="table" aria-label="Scan results">
            <div className="scan-results-head" role="rowgroup">
              <div className="scan-results-row" role="row">
                <span role="columnheader">File</span>
                <span role="columnheader">Vol (mL)</span>
                <span role="columnheader">Status</span>
              </div>
            </div>
            <div className="scan-results-body" role="rowgroup">
              {activeReport.rows.map((row) => {
                const failed = Boolean(row.status) && row.status !== "ok";
                return (
                  <Fragment key={row.path || row.filename}>
                    <div className="scan-results-row" role="row">
                      <span role="cell" className="scan-cell-file" title={`${row.filename} — ${row.subject_id}, ${formatStat(row.input_spacing_mm)} mm`}>
                        {row.filename || "-"}
                      </span>
                      <span role="cell" className="scan-cell-num">{formatStat(row.volume_ml)}</span>
                      <span role="cell" className={`scan-cell-status ${failed ? "fail" : ""}`}>{row.status || "-"}</span>
                    </div>
                    {row.error ? (
                      <div className="scan-results-error-row" role="row">
                        <span role="cell">{row.error}</span>
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <details className="panel-disclosure" open={runStatus?.state === "error"}>
        <summary>Run log</summary>
        {runLogs.length ? (
          <ol className="run-log-list">
            {runLogs.map((entry, index) => (
              <li key={`${index}-${entry}`}>{entry}</li>
            ))}
          </ol>
        ) : (
          <div className="inline-note">Run messages appear here after analysis starts.</div>
        )}
      </details>

      <details className="panel-disclosure">
        <summary>System check</summary>
        <Button className="secondary-button wide" isDisabled={isCheckingRuntime} onPress={onCheckRuntime}>
          <Stethoscope size={15} />
          {isCheckingRuntime ? "Checking" : runtimeReadiness.state === "unknown" ? "Check system" : "Recheck system"}
        </Button>
        <div className="checks-list">
          {runtimeChecks.length === 0 ? <div className="inline-note">{runtimeReadiness.detail}</div> : null}
          {runtimeChecks.map((check) => (
            <div className={`check-row ${check.status}`} key={`${check.label}-${check.detail}`}>
              <div className="check-row-head">
                <strong>{check.label}</strong>
                <span className="check-status">{check.status}</span>
              </div>
              <span className="check-detail">{check.detail}</span>
            </div>
          ))}
        </div>
      </details>
    </aside>
  );
}
