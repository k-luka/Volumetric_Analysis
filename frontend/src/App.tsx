import { useEffect, useMemo, useState } from "react";
import { getDefaults, getReport, getReports, openResultsFolder, selectDirectory, startRun } from "./lib/api";
import { errorText, folderValidationMessage } from "./lib/runProgress";
import { useTheme } from "./hooks/useTheme";
import { useReports } from "./hooks/useReports";
import { useFolderSelection } from "./hooks/useFolderSelection";
import { useRuntimeChecks } from "./hooks/useRuntimeChecks";
import { useRunStream } from "./hooks/useRunStream";
import type { DefaultsResponse } from "./types";
import { TopBar } from "./components/TopBar";
import { SetupPanel } from "./components/SetupPanel";
import { ResultsCanvas } from "./components/ResultsCanvas";
import { InspectorPanel } from "./components/InspectorPanel";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [defaults, setDefaults] = useState<DefaultsResponse | null>(null);
  const [deviceChoice, setDeviceChoice] = useState("auto");
  const [notice, setNotice] = useState<string | null>(null);
  const [isOpeningResultsFolder, setIsOpeningResultsFolder] = useState(false);
  const recursive = false;

  const reportsApi = useReports();
  const { reports, setReports, activeReport, setActiveReport, openReport, refreshReports } = reportsApi;

  const run = useRunStream({ onError: setNotice });
  const { runProgress, runStatus, logs, isRunning, isCancelling, activeRunId } = run;

  const folders = useFolderSelection({
    isRunning,
    onError: setNotice,
    onClearNotice: () => setNotice(null),
  });
  const {
    scanPaths,
    setScanPaths,
    outputDir,
    setOutputDir,
    validation,
    setValidation,
    outputValidation,
    setOutputValidation,
    isSelectingScans,
    isSelectingOutputDir,
    onSelectScans,
    onClearScans,
    onSelectOutputDir,
    validateFolders,
  } = folders;

  const runtime = useRuntimeChecks({ onClearNotice: () => setNotice(null) });
  const { runtimeChecks, runtimeReadiness, isCheckingRuntime, checkRuntime, onCheckRuntime } = runtime;

  const deviceChoices = useMemo(() => defaults?.deviceChoices ?? ["auto", "cpu", "mps", "cuda"], [defaults]);

  useEffect(() => {
    // Developer backdoor: with `?dev` in the URL, expose hooks so the scan and
    // output selection can be driven WITHOUT the native OS file picker. This is
    // only for automated end-to-end UI testing (the picker opens a Finder dialog
    // that browser automation can't reach). It has no effect during normal use
    // and is a no-op unless the query flag is present.
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (!params.has("dev")) {
      return;
    }

    // Open a finished report without running anything — lets us land directly in
    // the "already extracted" state (viewer, region menu, structure table) for
    // styling/QA. `which` is a report id, or "latest"/undefined for the newest.
    const openDevReport = async (which?: string) => {
      const list = await getReports();
      setReports(list);
      const target = which && which !== "latest" ? list.find((report) => report.id === which) : list[0];
      if (!target) {
        // eslint-disable-next-line no-console
        console.warn("[bv] openReport: no matching report found", which ?? "(latest)");
        return null;
      }
      const detail = await getReport(target.id);
      setActiveReport(detail);
      return detail;
    };

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
      openReport: openDevReport,
      // Review mode without the native picker: register a results folder by
      // path, then land in its newest report.
      openResultsFolder: async (path: string) => {
        const opened = await openResultsFolder(path);
        return openDevReport(opened.reports[0]?.id);
      },
    };
    (window as unknown as { __bvDev?: typeof hook }).__bvDev = hook;
    // eslint-disable-next-line no-console
    console.info("[bv] developer hook enabled: window.__bvDev.setScans([...]) / setOutput(dir) / clear() / openReport(id?)");

    // `?dev&report=latest` (or `&report=<id>`) auto-lands in a loaded report on
    // first paint, so the canvas/region menu render without a real run.
    if (params.has("report")) {
      openDevReport(params.get("report") ?? "latest").catch((error) => {
        // eslint-disable-next-line no-console
        console.warn("[bv] auto openReport failed:", errorText(error));
      });
    }

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
    };
  }, []);

  async function onRun() {
    setNotice(null);
    run.resetForNewRun();
    try {
      const { scanResult, outputResult } = await validateFolders();
      const validationMessage = folderValidationMessage(scanResult, outputResult);
      if (validationMessage) {
        setNotice(validationMessage);
        run.setRunProgress({
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
        run.setRunProgress({
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
      run.setRunProgress({
        state: "error",
        percent: 100,
        label: "System check failed",
        detail: message,
        currentFile: null,
        counts: null,
      });
      return;
    }
    run.setRunProgress({
      state: "queued",
      percent: 2,
      label: "Queued",
      detail: "Starting the local analysis worker.",
      currentFile: null,
      counts: null,
    });
    run.beginStarting();
    try {
      const runId = await startRun({ outputDir, recursive, deviceChoice, scanPaths });
      run.startStream(runId, {
        onComplete: async (status) => {
          if (status.reportId) {
            setActiveReport(await getReport(status.reportId));
          }
          await refreshReports(status.reportId);
        },
      });
    } catch (error) {
      run.failRun(errorText(error));
    }
  }

  async function onCancelRun() {
    if (!activeRunId) {
      return;
    }
    await run.cancelRunStream(activeRunId);
  }

  async function onOpenReport(id: string) {
    setNotice(null);
    try {
      await openReport(id);
    } catch (error) {
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

  // Review mode: open an existing results folder (e.g. downloaded HPC output)
  // and land in its newest report without running anything.
  async function onOpenResultsFolder() {
    setNotice(null);
    setIsOpeningResultsFolder(true);
    try {
      const picked = await selectDirectory(outputDir, "Open results folder");
      if (!picked.selected || !picked.path) {
        return;
      }
      const opened = await openResultsFolder(picked.path);
      await refreshReports(opened.reports[0]?.id ?? null);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setIsOpeningResultsFolder(false);
    }
  }

  return (
    <div className={`app-root ${theme === "light" ? "theme-light" : ""}`}>
      <TopBar theme={theme} onToggleTheme={toggleTheme} />
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
        />
        <ResultsCanvas
          report={activeReport}
          runProgress={runProgress}
          isRunning={isRunning}
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
          deviceChoice={deviceChoice}
          isOpeningResultsFolder={isOpeningResultsFolder}
          onCheckRuntime={onCheckRuntime}
          onOpenReport={onOpenReport}
          onReportsRefresh={onReportsRefresh}
          onOpenResultsFolder={onOpenResultsFolder}
        />
      </main>
    </div>
  );
}
