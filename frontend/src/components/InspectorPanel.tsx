import { useEffect, useState } from "react";
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import { Download, FileSpreadsheet, RefreshCcw, Stethoscope } from "lucide-react";
import { openDownload } from "../lib/api";
import type { ReportDetail, ReportSummary, RuntimeCheck, RuntimeReadiness, RunProgress, RunStatus } from "../types";

type InspectorPanelProps = {
  reports: ReportSummary[];
  activeReport: ReportDetail | null;
  runStatus: RunStatus | null;
  runProgress: RunProgress;
  logs: string[];
  runtimeChecks: RuntimeCheck[];
  runtimeReadiness: RuntimeReadiness;
  isCheckingRuntime: boolean;
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
        <p className="artifact-note">View the segmentation in the “Segmentation check” tab.</p>
      </section>

      <section className="panel-section">
        <div className="section-title">Run status</div>
        <div className={`status-card ${runProgress.state === "error" || runStatus?.state === "error" ? "error" : ""}`}>
          <span>State</span>
          <strong>{runStatus?.state ?? "idle"}</strong>
          <span>Device</span>
          <strong>{runStatus?.device ?? "auto"}</strong>
        </div>
        {failureMessage ? (
          <div className="run-error-note" role="status">
            <strong>{isCancelled ? "Run cancelled" : "Run failed"}</strong>
            <span>{failureMessage}</span>
          </div>
        ) : null}
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
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
            </div>
          ))}
        </div>
      </details>
    </aside>
  );
}
