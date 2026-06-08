import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { cancelRun, getChecks, getDefaults, getReport, getRun, getReports, selectDirectory, selectFiles, startRun, validateOutput, validateScans, createRunEventSource } from "./lib/api";
import type {
  DefaultsResponse,
  ReportDetail,
  ReportSummary,
  RuntimeCheck,
  RuntimeReadiness,
  RunProgress,
  RunStatus,
  ValidateOutputResponse,
  ValidateScansResponse,
  ViewerMode,
} from "./types";
import { TopBar } from "./components/TopBar";
import { SetupPanel } from "./components/SetupPanel";
import { ResultsCanvas } from "./components/ResultsCanvas";
import { InspectorPanel } from "./components/InspectorPanel";

const idleProgress: RunProgress = {
  state: "idle",
  percent: 0,
  label: "No run",
  detail: "Progress appears after analysis starts.",
  currentFile: null,
  counts: null,
};

const initialRuntimeReadiness: RuntimeReadiness = {
  state: "unknown",
  label: "System not checked",
  detail: "Will check before run.",
  checkedAt: null,
};

function messageFromPayload(payload: Record<string, unknown>): string | null {
  const value = payload.message;
  return typeof value === "string" && value.trim() ? value : null;
}

function parseEvent(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function appendMessage(setter: Dispatch<SetStateAction<string[]>>, payload: Record<string, unknown>) {
  const message = messageFromPayload(payload);
  if (message) {
    appendLog(setter, message);
  }
}

function appendLog(setter: Dispatch<SetStateAction<string[]>>, message: string) {
  setter((current) => {
    if (current[current.length - 1] === message) {
      return current;
    }
    return [...current, message].slice(-100);
  });
}

function numberFromPayload(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFromPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scanCountLabel(index: number | null, total: number | null): string | null {
  if (index === null || total === null || total <= 0) {
    return null;
  }
  return `${index} of ${total} scans`;
}

function progressFromEvent(eventName: string, payload: Record<string, unknown>): RunProgress {
  const index = numberFromPayload(payload, "index");
  const total = numberFromPayload(payload, "total");
  const filename = stringFromPayload(payload, "filename");
  const message = messageFromPayload(payload);
  const counts = scanCountLabel(index, total);
  const scanBase = 12;
  const scanSpan = 72;

  if (eventName === "start") {
    return {
      state: "running",
      percent: total !== null && total > 0 ? 8 : 4,
      label: total !== null && total > 0 ? "Preparing scans" : "Starting analysis",
      detail: total !== null && total > 0 ? `${total} scan${total === 1 ? "" : "s"} queued for analysis.` : (message ?? "Starting the analysis run."),
      currentFile: null,
      counts: total !== null && total > 0 ? `0 of ${total} scans` : null,
    };
  }

  if (eventName === "scan_start") {
    const completedBefore = index !== null && total !== null && total > 0 ? (index - 1) / total : 0;
    return {
      state: "running",
      percent: clampPercent(scanBase + completedBefore * scanSpan + 6),
      label: "Segmenting scan",
      detail: filename ?? message ?? "Processing scan.",
      currentFile: filename,
      counts,
    };
  }

  if (eventName === "scan_done") {
    const completed = index !== null && total !== null && total > 0 ? index / total : 0.85;
    return {
      state: "running",
      percent: clampPercent(scanBase + completed * scanSpan),
      label: "Scan finished",
      detail: message ?? filename ?? "Scan processing finished.",
      currentFile: filename,
      counts,
    };
  }

  if (eventName === "analysis_summary") {
    return {
      state: "running",
      percent: 90,
      label: "Summarizing results",
      detail: message ?? "Preparing report data.",
      currentFile: null,
      counts: total !== null ? `${total} scan${total === 1 ? "" : "s"} analyzed` : null,
    };
  }

  if (eventName === "report_written") {
    return {
      state: "running",
      percent: 96,
      label: "Report written",
      detail: message ?? "Report artifacts are ready.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "complete") {
    return {
      state: "complete",
      percent: 100,
      label: "Analysis complete",
      detail: message ?? "Results are ready.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "cancelled") {
    return {
      state: "cancelled",
      percent: 100,
      label: "Run cancelled",
      detail: message ?? "Analysis cancelled.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "error") {
    return {
      state: "error",
      percent: 100,
      label: "Run failed",
      detail: message ?? "Analysis failed.",
      currentFile: null,
      counts: null,
    };
  }

  if (eventName === "no_scans") {
    return {
      state: "error",
      percent: 100,
      label: "No scans found",
      detail: message ?? "No .nii or .nii.gz scans were found.",
      currentFile: null,
      counts: null,
    };
  }

  return {
    state: "running",
    percent: 8,
    label: "Running analysis",
    detail: message ?? eventName,
    currentFile: null,
    counts: null,
  };
}

function initialTheme(): "dark" | "light" {
  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== "function") {
      return "dark";
    }
    const stored = storage.getItem("volumetric-theme");
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function storeTheme(theme: "dark" | "light") {
  try {
    const storage = window.localStorage;
    if (storage && typeof storage.setItem === "function") {
      storage.setItem("volumetric-theme", theme);
    }
  } catch {
    // Theme persistence is optional; the UI still works when storage is unavailable.
  }
}

function folderValidationMessage(scanResult: ValidateScansResponse, outputResult: ValidateOutputResponse): string | null {
  if (!scanResult.exists || scanResult.scanCount === 0) {
    return "Select at least one .nii or .nii.gz scan to analyze.";
  }
  if (scanResult.problems.length > 0) {
    const first = scanResult.problems[0];
    return `${first.name}: ${first.error}`;
  }
  if (scanResult.readableCount === 0) {
    return "No readable scans were selected. Check the files and voxel spacing.";
  }
  if (outputResult.status !== "ok" || !outputResult.canWrite) {
    return outputResult.message;
  }
  return null;
}

function summarizeRuntimeChecks(checks: RuntimeCheck[]): RuntimeReadiness {
  const checkedAt = new Date().toISOString();
  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  if (failures.length > 0) {
    const first = failures[0];
    return {
      state: "failed",
      label: "System issue",
      detail: `${first.label}: ${first.detail}`,
      checkedAt,
    };
  }
  if (warnings.length > 0) {
    const first = warnings[0];
    return {
      state: "warning",
      label: "System warning",
      detail: `${first.label}: ${first.detail}`,
      checkedAt,
    };
  }
  return {
    state: "ready",
    label: "System ready",
    detail: "Checks passed.",
    checkedAt,
  };
}

function failedRuntimeReadiness(message: string): RuntimeReadiness {
  return {
    state: "failed",
    label: "System check failed",
    detail: message,
    checkedAt: new Date().toISOString(),
  };
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(initialTheme);
  const [defaults, setDefaults] = useState<DefaultsResponse | null>(null);
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const recursive = false;
  const [deviceChoice, setDeviceChoice] = useState("auto");
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [activeReport, setActiveReport] = useState<ReportDetail | null>(null);
  const [viewerMode, setViewerMode] = useState<ViewerMode>("montage");
  const [viewerCtx, setViewerCtx] = useState<{ inSegView: boolean; hasVolume: boolean }>({ inSegView: false, hasVolume: false });
  const [validation, setValidation] = useState<ValidateScansResponse | null>(null);
  const [outputValidation, setOutputValidation] = useState<ValidateOutputResponse | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [runProgress, setRunProgress] = useState<RunProgress>(idleProgress);
  const [logs, setLogs] = useState<string[]>([]);
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeCheck[]>([]);
  const [runtimeReadiness, setRuntimeReadiness] = useState<RuntimeReadiness>(initialRuntimeReadiness);
  const [isCheckingRuntime, setIsCheckingRuntime] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isSelectingScans, setIsSelectingScans] = useState(false);
  const [isSelectingOutputDir, setIsSelectingOutputDir] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const deviceChoices = useMemo(() => defaults?.deviceChoices ?? ["auto", "cpu", "mps", "cuda"], [defaults]);

  useEffect(() => {
    storeTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Developer backdoor: with `?dev` in the URL, expose hooks so the scan and
    // output selection can be driven WITHOUT the native OS file picker. This is
    // only for automated end-to-end UI testing (the picker opens a Finder dialog
    // that browser automation can't reach). It has no effect during normal use
    // and is a no-op unless the query flag is present.
    if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("dev")) {
      return;
    }
    const hook = {
      setScans: (paths: string[] | string) => {
        setScanPaths(Array.isArray(paths) ? paths : [paths]);
        setValidation(null);
      },
      setOutput: (dir: string) => {
        setOutputDir(dir);
        setOutputValidation(null);
      },
      clear: () => {
        setScanPaths([]);
        setValidation(null);
      },
    };
    (window as unknown as { __bvDev?: typeof hook }).__bvDev = hook;
    // eslint-disable-next-line no-console
    console.info("[bv] developer hook enabled: window.__bvDev.setScans([...]) / setOutput(dir) / clear()");
    return () => {
      delete (window as unknown as { __bvDev?: typeof hook }).__bvDev;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    getDefaults()
      .then(async (data) => {
        if (!mounted) {
          return;
        }
        setDefaults(data);
        setOutputDir(data.outputDir);
        setDeviceChoice("auto");
        setReports(data.reports);
      })
      .catch((error) => setNotice(errorText(error)));
    return () => {
      mounted = false;
      eventSourceRef.current?.close();
    };
  }, []);

  async function refreshReports(reportId?: string | null) {
    const list = await getReports();
    setReports(list);
    const id = reportId && list.some((report) => report.id === reportId) ? reportId : list[0]?.id;
    if (!id) {
      setActiveReport(null);
      return;
    }
    setActiveReport(await getReport(id));
  }

  async function onSelectScans() {
    setNotice(null);
    setIsSelectingScans(true);
    try {
      const initial = scanPaths.length > 0 ? scanPaths[0] : "";
      const result = await selectFiles(initial, "Select brain scans");
      if (result.selected && result.paths.length > 0) {
        setScanPaths(result.paths);
        setValidation(null);
      }
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setIsSelectingScans(false);
    }
  }

  function onClearScans() {
    setScanPaths([]);
    setValidation(null);
  }

  async function onSelectOutputDir() {
    setNotice(null);
    setIsSelectingOutputDir(true);
    try {
      const result = await selectDirectory(outputDir, "Select results folder");
      if (result.selected && result.path) {
        setOutputDir(result.path);
        setOutputValidation(null);
      }
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setIsSelectingOutputDir(false);
    }
  }

  async function validateFolders() {
    const [scanResult, outputResult] = await Promise.all([validateScans("", recursive, scanPaths), validateOutput(outputDir)]);
    setValidation(scanResult);
    setOutputValidation(outputResult);
    return { scanResult, outputResult };
  }

  // Auto-validate the selection: once scans and an output folder are chosen, run
  // the lightweight checks automatically so the "Ready" cards appear without a
  // manual button. Debounced; Run analysis still re-validates as a safety net.
  useEffect(() => {
    if (!scanPaths.length || !outputDir.trim() || isRunning) {
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      Promise.all([validateScans("", recursive, scanPaths), validateOutput(outputDir)])
        .then(([scanResult, outputResult]) => {
          if (cancelled) {
            return;
          }
          setValidation(scanResult);
          setOutputValidation(outputResult);
        })
        .catch(() => {
          /* Validation failures here are non-fatal; Run analysis surfaces them. */
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [scanPaths, outputDir, isRunning]);

  async function checkRuntime(force = false): Promise<RuntimeCheck[]> {
    if (!force && runtimeReadiness.state !== "unknown" && runtimeChecks.length > 0) {
      return runtimeChecks;
    }
    setIsCheckingRuntime(true);
    setRuntimeReadiness((current) => ({
      state: "checking",
      label: "Checking system",
      detail: "Python and FastSurfer.",
      checkedAt: current.checkedAt,
    }));
    try {
      const checks = await getChecks();
      setRuntimeChecks(checks);
      setRuntimeReadiness(summarizeRuntimeChecks(checks));
      return checks;
    } catch (error) {
      const message = errorText(error);
      const fallbackChecks: RuntimeCheck[] = [
        {
          label: "System check",
          status: "fail",
          detail: message,
        },
      ];
      setRuntimeChecks(fallbackChecks);
      setRuntimeReadiness(failedRuntimeReadiness(message));
      return fallbackChecks;
    } finally {
      setIsCheckingRuntime(false);
    }
  }

  async function onCheckRuntime() {
    setNotice(null);
    await checkRuntime(true);
  }

  async function onRun() {
    setNotice(null);
    setLogs([]);
    setRunStatus(null);
    try {
      const { scanResult, outputResult } = await validateFolders();
      const validationMessage = folderValidationMessage(scanResult, outputResult);
      if (validationMessage) {
        setNotice(validationMessage);
        setRunProgress({
          state: "error",
          percent: 100,
          label: "Folders not ready",
          detail: validationMessage,
          currentFile: null,
          counts: null,
        });
        return;
      }
      const checks = await checkRuntime(false);
      const failures = checks.filter((check) => check.status === "fail");
      if (failures.length > 0) {
        const message = `System is not ready: ${failures.map((check) => `${check.label} - ${check.detail}`).join("; ")}`;
        setNotice(message);
        setRunProgress({
          state: "error",
          percent: 100,
          label: "System not ready",
          detail: message,
          currentFile: null,
          counts: null,
        });
        return;
      }
    } catch (error) {
      const message = errorText(error);
      setNotice(message);
      setRunProgress({
        state: "error",
        percent: 100,
        label: "System check failed",
        detail: message,
        currentFile: null,
        counts: null,
      });
      return;
    }
    setRunProgress({
      state: "queued",
      percent: 2,
      label: "Queued",
      detail: "Starting the local analysis worker.",
      currentFile: null,
      counts: null,
    });
    setIsRunning(true);
    eventSourceRef.current?.close();
    try {
      const runId = await startRun({ outputDir, recursive, deviceChoice, scanPaths });
      setActiveRunId(runId);
      const source = createRunEventSource(runId);
      eventSourceRef.current = source;
      function handleRunEvent(eventName: string, event: Event) {
        const payload = parseEvent(event as MessageEvent<string>);
        appendMessage(setLogs, payload);
        setRunProgress(progressFromEvent(eventName, payload));
        return payload;
      }
      source.addEventListener("start", (event) => {
        handleRunEvent("start", event);
      });
      source.addEventListener("no_scans", (event) => {
        handleRunEvent("no_scans", event);
      });
      source.addEventListener("scan_start", (event) => {
        handleRunEvent("scan_start", event);
      });
      source.addEventListener("scan_done", (event) => {
        handleRunEvent("scan_done", event);
      });
      source.addEventListener("analysis_summary", (event) => {
        handleRunEvent("analysis_summary", event);
      });
      source.addEventListener("report_written", (event) => {
        handleRunEvent("report_written", event);
      });
      source.addEventListener("complete", async (event) => {
        const payload = handleRunEvent("complete", event);
        source.close();
        try {
          const status = await getRun(runId);
          setRunStatus(status);
          if (status.logs.length) {
            setLogs(status.logs);
          }
          if (status.reportId) {
            setActiveReport(await getReport(status.reportId));
          }
          await refreshReports(status.reportId);
        } catch (error) {
          const message = errorText(error);
          setNotice(message);
          appendLog(setLogs, message);
        } finally {
          setIsRunning(false);
          setIsCancelling(false);
          setActiveRunId(null);
        }
      });
      source.addEventListener("cancelled", async (event) => {
        handleRunEvent("cancelled", event);
        source.close();
        const status = await getRun(runId).catch(() => null);
        if (status) {
          setRunStatus(status);
          if (status.logs.length) {
            setLogs(status.logs);
          }
        }
        setIsRunning(false);
        setIsCancelling(false);
        setActiveRunId(null);
      });
      source.addEventListener("error", async (event) => {
        const payload = parseEvent(event as MessageEvent<string>);
        const eventMessage = messageFromPayload(payload);
        source.close();
        const status = await getRun(runId).catch(() => null);
        const message = status?.error ?? eventMessage ?? "Run event stream disconnected.";
        setRunProgress(progressFromEvent(status?.state === "cancelled" ? "cancelled" : "error", { ...payload, message }));
        setNotice(message);
        appendLog(setLogs, message);
        setRunStatus(status);
        if (status?.logs.length) {
          setLogs(status.logs);
        }
        setIsRunning(false);
        setIsCancelling(false);
        setActiveRunId(null);
      });
    } catch (error) {
      const message = errorText(error);
      setNotice(message);
      appendLog(setLogs, message);
      setRunProgress({
        state: "error",
        percent: 100,
        label: "Run failed",
        detail: message,
        currentFile: null,
        counts: null,
      });
      setIsRunning(false);
      setIsCancelling(false);
      setActiveRunId(null);
    }
  }

  async function onCancelRun() {
    if (!activeRunId) {
      return;
    }
    setIsCancelling(true);
    appendLog(setLogs, "Cancelling run…");
    try {
      await cancelRun(activeRunId);
    } catch (error) {
      setNotice(errorText(error));
      setIsCancelling(false);
    }
  }

  async function onOpenReport(id: string) {
    setNotice(null);
    try {
      setActiveReport(await getReport(id));
    } catch (error) {
      setReports(await getReports().catch(() => reports));
      if (activeReport?.id === id) {
        setActiveReport(null);
      }
      setNotice(errorText(error));
    }
  }

  async function onReportsRefresh() {
    setNotice(null);
    try {
      await refreshReports(activeReport?.id ?? null);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  return (
    <div className={`app-root ${theme === "light" ? "theme-light" : ""}`}>
      <TopBar theme={theme} onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} />
      {notice ? <div className="notice-bar">{notice}</div> : null}
      <main className="workbench-shell">
        <SetupPanel
          scanPaths={scanPaths}
          outputDir={outputDir}
          deviceChoice={deviceChoice}
          deviceChoices={deviceChoices}
          validation={validation}
          outputValidation={outputValidation}
          isRunning={isRunning}
          isCancelling={isCancelling}
          isCheckingRuntime={isCheckingRuntime}
          runtimeReadiness={runtimeReadiness}
          isSelectingScans={isSelectingScans}
          isSelectingOutputDir={isSelectingOutputDir}
          onDeviceChoiceChange={setDeviceChoice}
          onSelectScans={onSelectScans}
          onClearScans={onClearScans}
          onSelectOutputDir={onSelectOutputDir}
          onCheckRuntime={onCheckRuntime}
          onRun={onRun}
          onCancelRun={onCancelRun}
          viewerControlsVisible={viewerCtx.inSegView}
          viewerHasVolume={viewerCtx.hasVolume}
          viewerMode={viewerMode}
          onViewerModeChange={setViewerMode}
        />
        <ResultsCanvas
          report={activeReport}
          runProgress={runProgress}
          isRunning={isRunning}
          viewerMode={viewerMode}
          onViewerModeChange={setViewerMode}
          onViewerContextChange={setViewerCtx}
        />
        <InspectorPanel
          reports={reports}
          activeReport={activeReport}
          runStatus={runStatus}
          runProgress={runProgress}
          logs={logs}
          runtimeChecks={runtimeChecks}
          runtimeReadiness={runtimeReadiness}
          isCheckingRuntime={isCheckingRuntime}
          onCheckRuntime={onCheckRuntime}
          onOpenReport={onOpenReport}
          onReportsRefresh={onReportsRefresh}
        />
      </main>
    </div>
  );
}
