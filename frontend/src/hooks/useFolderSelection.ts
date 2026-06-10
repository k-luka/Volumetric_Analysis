import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { selectDirectory, selectFiles, validateOutput, validateScans } from "../lib/api";
import { errorText } from "../lib/runProgress";
import type { ValidateOutputResponse, ValidateScansResponse } from "../types";

export type UseFolderSelection = {
  scanPaths: string[];
  setScanPaths: Dispatch<SetStateAction<string[]>>;
  outputDir: string;
  setOutputDir: Dispatch<SetStateAction<string>>;
  validation: ValidateScansResponse | null;
  setValidation: Dispatch<SetStateAction<ValidateScansResponse | null>>;
  outputValidation: ValidateOutputResponse | null;
  setOutputValidation: Dispatch<SetStateAction<ValidateOutputResponse | null>>;
  isSelectingScans: boolean;
  isSelectingOutputDir: boolean;
  onSelectScans: () => Promise<void>;
  onClearScans: () => void;
  onSelectOutputDir: () => Promise<void>;
  validateFolders: () => Promise<{ scanResult: ValidateScansResponse; outputResult: ValidateOutputResponse }>;
};

export function useFolderSelection({
  isRunning,
  onError,
  onClearNotice,
}: {
  isRunning: boolean;
  onError: (message: string) => void;
  onClearNotice: () => void;
}): UseFolderSelection {
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState("");
  // `recursive` selection is currently always off; kept as a const so the
  // validate/run calls keep their explicit positional argument.
  const recursive = false;
  const [validation, setValidation] = useState<ValidateScansResponse | null>(null);
  const [outputValidation, setOutputValidation] = useState<ValidateOutputResponse | null>(null);
  const [isSelectingScans, setIsSelectingScans] = useState(false);
  const [isSelectingOutputDir, setIsSelectingOutputDir] = useState(false);

  async function onSelectScans() {
    onClearNotice();
    setIsSelectingScans(true);
    try {
      const initial = scanPaths.length > 0 ? scanPaths[0] : "";
      const result = await selectFiles(initial, "Select brain scans");
      if (result.selected && result.paths.length > 0) {
        setScanPaths(result.paths);
        setValidation(null);
      }
    } catch (error) {
      onError(errorText(error));
    } finally {
      setIsSelectingScans(false);
    }
  }

  function onClearScans() {
    setScanPaths([]);
    setValidation(null);
  }

  async function onSelectOutputDir() {
    onClearNotice();
    setIsSelectingOutputDir(true);
    try {
      const result = await selectDirectory(outputDir, "Select results folder");
      if (result.selected && result.path) {
        setOutputDir(result.path);
        setOutputValidation(null);
      }
    } catch (error) {
      onError(errorText(error));
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

  return {
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
  };
}
