import { useState } from "react";
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import { CheckCircle2, ChevronDown, FileText, FolderOpen, Play, Square, Stethoscope, X } from "lucide-react";
import type { RuntimeReadiness, ValidateOutputResponse, ValidateScansResponse } from "../types";

type SetupPanelProps = {
  scanPaths: string[];
  outputDir: string;
  deviceChoice: string;
  deviceChoices: string[];
  validation: ValidateScansResponse | null;
  outputValidation: ValidateOutputResponse | null;
  isRunning: boolean;
  isCancelling: boolean;
  isCheckingRuntime: boolean;
  runtimeReadiness: RuntimeReadiness;
  isSelectingScans: boolean;
  isSelectingOutputDir: boolean;
  onDeviceChoiceChange: (value: string) => void;
  onSelectScans: () => void;
  onClearScans: () => void;
  onSelectOutputDir: () => void;
  onCheckRuntime: () => void;
  onRun: () => void;
  onCancelRun: () => void;
};

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

const DEVICE_LABELS: Record<string, string> = {
  auto: "Automatic",
  cpu: "CPU",
  mps: "Apple GPU (MPS)",
  cuda: "NVIDIA GPU (CUDA)",
};

function deviceLabel(choice: string): string {
  return DEVICE_LABELS[choice] ?? choice;
}

export function SetupPanel({
  scanPaths,
  outputDir,
  deviceChoice,
  deviceChoices,
  validation,
  outputValidation,
  isRunning,
  isCancelling,
  isCheckingRuntime,
  runtimeReadiness,
  isSelectingScans,
  isSelectingOutputDir,
  onDeviceChoiceChange,
  onSelectScans,
  onClearScans,
  onSelectOutputDir,
  onCheckRuntime,
  onRun,
  onCancelRun,
}: SetupPanelProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const hasScans = scanPaths.length > 0;
  const hasOutputDir = outputDir.trim().length > 0;
  const hasValidatedScans = Boolean(validation?.exists && validation.readableCount > 0 && validation.problems.length === 0);
  const hasValidatedOutput = Boolean(outputValidation?.status === "ok" && outputValidation.canWrite);
  const hasKnownInvalidScans = Boolean(validation && !hasValidatedScans);
  const hasKnownInvalidOutput = Boolean(outputValidation && !hasValidatedOutput);
  const busy = isRunning || isSelectingScans || isSelectingOutputDir;
  const canRun = hasScans && hasOutputDir && !hasKnownInvalidScans && !hasKnownInvalidOutput && !isCheckingRuntime && !busy;
  const ready = Boolean(validation?.exists && validation.readableCount > 0 && validation.problems.length === 0);
  const outputReadyMessage = outputValidation?.exists ? "Ready" : "Ready to create";
  const runtimeButtonLabel = runtimeReadiness.state === "unknown" ? "Check system status" : "Recheck system status";

  return (
    <aside className="panel setup-panel">
      <div className="panel-title">
        <span>Scans & output</span>
      </div>

      <div className="control-stack">
        <div className="field">
          <Label>Brain scans</Label>
          <Button className="secondary-button wide" isDisabled={isRunning || isSelectingScans} onPress={onSelectScans}>
            <FolderOpen size={16} />
            {isSelectingScans ? "Opening picker…" : hasScans ? "Choose different scans…" : "Choose scans…"}
          </Button>
          {hasScans ? (
            <div className="selected-files">
              <div className="selected-files-head">
                <span>
                  {scanPaths.length} scan{scanPaths.length === 1 ? "" : "s"} selected
                </span>
                <button type="button" className="link-button" onClick={onClearScans} disabled={isRunning}>
                  <X size={12} /> Clear
                </button>
              </div>
              <ul>
                {scanPaths.map((path) => (
                  <li key={path} title={path}>
                    <FileText size={13} />
                    <span className="selected-file-name">{baseName(path)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <span className="field-hint warning">No scans selected. Click “Choose scans…” to pick .nii / .nii.gz files.</span>
          )}
        </div>

        <div className="field">
          <Label>Results folder</Label>
          <Button className="secondary-button wide" isDisabled={isRunning || isSelectingOutputDir} onPress={onSelectOutputDir}>
            <FolderOpen size={16} />
            {isSelectingOutputDir ? "Opening picker…" : "Choose results folder…"}
          </Button>
          {hasOutputDir ? (
            <div className="selected-path" title={outputDir}>
              {outputDir}
            </div>
          ) : (
            <span className="field-hint warning">No results folder selected.</span>
          )}
        </div>

        <div className={`button-row ${isRunning ? "" : "single"}`}>
          {isRunning ? (
            <Button className="secondary-button danger-button" isDisabled={isCancelling} onPress={onCancelRun}>
              <Square size={15} />
              {isCancelling ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
          <Button className="primary-button" isDisabled={!canRun} onPress={onRun}>
            <Play size={16} />
            {isRunning ? "Running" : "Run analysis"}
          </Button>
        </div>
        <div className={`system-status ${runtimeReadiness.state} ${statusOpen ? "open" : ""}`}>
          <div className="system-status-row">
            <button
              type="button"
              className="system-status-toggle"
              aria-expanded={statusOpen}
              aria-controls="system-status-details"
              aria-label={`System status: ${runtimeReadiness.label}. ${statusOpen ? "Hide" : "Show"} scan and results folder details.`}
              onClick={() => setStatusOpen((open) => !open)}
            >
              <span className="runtime-dot" aria-hidden="true" />
              <span className="runtime-copy" title={runtimeReadiness.detail}>
                <strong>{runtimeReadiness.label}</strong>
                <span>{runtimeReadiness.detail}</span>
              </span>
              <ChevronDown className="system-status-chevron" size={14} aria-hidden="true" />
            </button>
            <Button className="runtime-check-button" aria-label={runtimeButtonLabel} isDisabled={isRunning || isCheckingRuntime} onPress={onCheckRuntime}>
              <Stethoscope size={14} />
            </Button>
          </div>
          {statusOpen ? (
            <div id="system-status-details" className="system-status-details">
              {validation ? (
                <div className="selection-summary">
                  <div>
                    <strong>{validation.scanCount} scan file(s)</strong>, <strong>{validation.readableCount} readable</strong>
                  </div>
                  {validation.scanCount === 0 && validation.problems.length === 0 ? <span className="warning">No scans selected</span> : null}
                  {validation.problems.length > 0 ? <span className="danger">{validation.problems.length} problem(s)</span> : null}
                  {validation.problems[0] ? <span className="danger">{validation.problems[0].name}: {validation.problems[0].error}</span> : null}
                  {ready ? (
                    <span className="ok">
                      <CheckCircle2 size={14} /> Ready
                    </span>
                  ) : null}
                </div>
              ) : null}
              {outputValidation ? (
                <div className="selection-summary">
                  <div>
                    <strong>Results folder</strong>
                  </div>
                  <span className={outputValidation.status === "ok" ? "ok" : outputValidation.status === "warn" ? "warning" : "danger"}>
                    {outputValidation.status === "ok" ? <CheckCircle2 size={14} /> : null}
                    {outputValidation.status === "ok" ? outputReadyMessage : "Not ready"}
                  </span>
                  <span>{outputValidation.message}</span>
                  {outputValidation.path ? <span className="muted-path">{outputValidation.path}</span> : null}
                </div>
              ) : null}
              {!validation && !outputValidation ? (
                <span className="status-empty-note">Select scans and a results folder to check their status.</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel-divider" />

      <section className="panel-section">
        <div className="section-title">Processing</div>
        <Select className="select-field" selectedKey={deviceChoice} onSelectionChange={(key) => onDeviceChoiceChange(String(key))}>
          <Label>Compute device</Label>
          <Button className="select-trigger">
            <SelectValue />
          </Button>
          <Popover className="select-popover">
            <ListBox className="select-list">
              {deviceChoices.map((choice) => (
                <ListBoxItem className="select-option" id={choice} key={choice} textValue={deviceLabel(choice)}>
                  {deviceLabel(choice)}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
      </section>
    </aside>
  );
}
