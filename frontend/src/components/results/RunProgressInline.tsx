import { useEffect, useRef, useState } from "react";
import type { RunProgress } from "../../types";

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

export function RunProgressInline({ progress, isRunning }: { progress: RunProgress; isRunning: boolean }) {
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
