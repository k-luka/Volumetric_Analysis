import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { cancelRun, createRunEventSource, getRun } from "../lib/api";
import {
  errorText,
  idleProgress,
  messageFromPayload,
  parseEvent,
  progressFromEvent,
} from "../lib/runProgress";
import type { RunProgress, RunStatus } from "../types";

// EventSource.readyState value for a connection the browser has permanently
// given up on. Hardcoded because the EventSource global isn't present under
// jsdom (tests mock the stream): 0 CONNECTING, 1 OPEN, 2 CLOSED.
const EVENT_SOURCE_CLOSED = 2;

// Single source of truth for the run lifecycle. `isRunning`, `isCancelling`,
// and `activeRunId` are DERIVED from this so they can never drift out of sync.
//  - idle:       no run in flight
//  - starting:   onRun has begun (queued) but startRun hasn't returned a runId yet
//  - running:    stream is live for `runId`
//  - cancelling: a cancel was requested for `runId`, awaiting the terminal event
type RunPhase =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "running"; runId: string }
  | { status: "cancelling"; runId: string };

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

export type UseRunStream = {
  runProgress: RunProgress;
  runStatus: RunStatus | null;
  logs: string[];
  isRunning: boolean;
  isCancelling: boolean;
  activeRunId: string | null;
  setRunProgress: Dispatch<SetStateAction<RunProgress>>;
  setRunStatus: Dispatch<SetStateAction<RunStatus | null>>;
  setLogs: Dispatch<SetStateAction<string[]>>;
  appendLogLine: (message: string) => void;
  resetForNewRun: () => void;
  beginStarting: () => void;
  startStream: (runId: string, options: { onComplete: (status: RunStatus) => Promise<void> | void }) => void;
  cancelRunStream: (runId: string) => Promise<void>;
  failRun: (message: string) => void;
};

export function useRunStream({ onError }: { onError: (message: string) => void }): UseRunStream {
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [runProgress, setRunProgress] = useState<RunProgress>(idleProgress);
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState<RunPhase>({ status: "idle" });
  const eventSourceRef = useRef<EventSource | null>(null);

  const isRunning = phase.status !== "idle";
  const isCancelling = phase.status === "cancelling";
  const activeRunId = phase.status === "running" || phase.status === "cancelling" ? phase.runId : null;

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const appendLogLine = (message: string) => appendLog(setLogs, message);

  // Reset logs/status at the start of onRun (mirrors the head of the old onRun).
  function resetForNewRun() {
    setLogs([]);
    setRunStatus(null);
  }

  // Enter the queued/"starting" phase and close any prior stream, matching the
  // old `setIsRunning(true); eventSourceRef.current?.close();` ordering.
  function beginStarting() {
    setPhase({ status: "starting" });
    eventSourceRef.current?.close();
  }

  function startStream(runId: string, { onComplete }: { onComplete: (status: RunStatus) => Promise<void> | void }) {
    setPhase({ status: "running", runId });
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
      handleRunEvent("complete", event);
      source.close();
      try {
        const status = await getRun(runId);
        setRunStatus(status);
        if (status.logs.length) {
          setLogs(status.logs);
        }
        await onComplete(status);
      } catch (error) {
        const message = errorText(error);
        onError(message);
        appendLog(setLogs, message);
      } finally {
        setPhase({ status: "idle" });
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
      setPhase({ status: "idle" });
    });
    source.addEventListener("error", async (event) => {
      const messageEvent = event as MessageEvent<string>;
      const hasServerPayload = typeof messageEvent.data === "string" && messageEvent.data.length > 0;

      // "error" fires for two very different reasons:
      //  1. The backend's own `error` run event — a genuine failure that
      //     carries a JSON payload.
      //  2. A native EventSource connection drop — no payload; the browser is
      //     already auto-reconnecting. Tearing a live run down on a transient
      //     blip would abandon a run that is still going on the server, so for
      //     a payload-less error we only finalize when the backend reports the
      //     run actually ended, or the browser has given up (readyState
      //     CLOSED). Otherwise we leave the stream to reconnect.
      if (!hasServerPayload) {
        const status = await getRun(runId).catch(() => null);
        const stillActive = status?.state === "running" || status?.state === "queued";
        if (stillActive && source.readyState !== EVENT_SOURCE_CLOSED) {
          return;
        }
        source.close();
        const message = status?.error ?? "Run event stream disconnected.";
        setRunProgress(progressFromEvent(status?.state === "cancelled" ? "cancelled" : "error", { message }));
        onError(message);
        appendLog(setLogs, message);
        setRunStatus(status);
        if (status?.logs.length) {
          setLogs(status.logs);
        }
        setPhase({ status: "idle" });
        return;
      }

      const payload = parseEvent(messageEvent);
      const eventMessage = messageFromPayload(payload);
      source.close();
      const status = await getRun(runId).catch(() => null);
      const message = status?.error ?? eventMessage ?? "Run event stream disconnected.";
      setRunProgress(progressFromEvent(status?.state === "cancelled" ? "cancelled" : "error", { ...payload, message }));
      onError(message);
      appendLog(setLogs, message);
      setRunStatus(status);
      if (status?.logs.length) {
        setLogs(status.logs);
      }
      setPhase({ status: "idle" });
    });
  }

  // Mirrors the old onRun catch block: surface the error, log it, set an error
  // progress card, and reset the lifecycle to idle.
  function failRun(message: string) {
    onError(message);
    appendLog(setLogs, message);
    setRunProgress({
      state: "error",
      percent: 100,
      label: "Run failed",
      detail: message,
      currentFile: null,
      counts: null,
    });
    setPhase({ status: "idle" });
  }

  async function cancelRunStream(runId: string) {
    setPhase({ status: "cancelling", runId });
    appendLog(setLogs, "Cancelling run…");
    try {
      await cancelRun(runId);
    } catch (error) {
      onError(errorText(error));
      // Revert to the running phase (cancel request failed; run is still live).
      setPhase({ status: "running", runId });
    }
  }

  return {
    runProgress,
    runStatus,
    logs,
    isRunning,
    isCancelling,
    activeRunId,
    setRunProgress,
    setRunStatus,
    setLogs,
    appendLogLine,
    resetForNewRun,
    beginStarting,
    startStream,
    cancelRunStream,
    failRun,
  };
}
