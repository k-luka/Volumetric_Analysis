import { useState } from "react";
import { getChecks } from "../lib/api";
import { errorText } from "../lib/runProgress";
import type { RuntimeCheck, RuntimeReadiness } from "../types";

const initialRuntimeReadiness: RuntimeReadiness = {
  state: "unknown",
  label: "System not checked",
  detail: "Will check before run.",
  checkedAt: null,
};

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

export type UseRuntimeChecks = {
  runtimeChecks: RuntimeCheck[];
  runtimeReadiness: RuntimeReadiness;
  isCheckingRuntime: boolean;
  checkRuntime: (force?: boolean) => Promise<RuntimeCheck[]>;
  onCheckRuntime: () => Promise<void>;
};

export function useRuntimeChecks({ onClearNotice }: { onClearNotice: () => void }): UseRuntimeChecks {
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeCheck[]>([]);
  const [runtimeReadiness, setRuntimeReadiness] = useState<RuntimeReadiness>(initialRuntimeReadiness);
  const [isCheckingRuntime, setIsCheckingRuntime] = useState(false);

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
    onClearNotice();
    await checkRuntime(true);
  }

  return { runtimeChecks, runtimeReadiness, isCheckingRuntime, checkRuntime, onCheckRuntime };
}
