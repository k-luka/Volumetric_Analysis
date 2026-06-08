from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import platform
import socket
import subprocess
import sys
import threading
import uuid
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from hydra import compose, initialize_config_dir
from pydantic import BaseModel

from volumetric_analysis.check_env import run_checks
from volumetric_analysis.report_pdf import build_pdf_report
from volumetric_analysis.run import (
    REPORT_COLUMNS,
    SEGMENTATION_NAME,
    RunCancelled,
    RunControl,
    display_path,
    find_scans,
    read_spacing,
    run_analysis,
    run_id_from_report_path,
    strip_nii_suffix,
)
from volumetric_analysis.structures import MAX_LABEL, atlas_regions, brain_totals, structure_volumes


PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent
CONFIG_DIR = REPO_ROOT / "config"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
BUNDLED_FASTSURFER = REPO_ROOT / "external" / "fastsurfer" / "run_fastsurfer.sh"
DEFAULT_TUTORIAL_SCAN = REPO_ROOT / "data" / "tutorial" / "140_orig.nii.gz"
DEFAULT_INPUT_DIR = DEFAULT_TUTORIAL_SCAN.parent if DEFAULT_TUTORIAL_SCAN.exists() else REPO_ROOT / "data"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "outputs" / "ui_demo"

RunState = Literal["queued", "running", "complete", "error", "cancelled"]
ValidationStatus = Literal["ok", "warn", "error"]
ReportSource = Literal["saved", "current_run"]


class ReportSummary(BaseModel):
    id: str
    name: str
    outputDir: str
    reportPath: str
    modified: float
    source: ReportSource = "saved"
    temporary: bool = False


class DefaultsResponse(BaseModel):
    inputDir: str
    outputDir: str
    recursive: bool
    defaultDevice: str
    deviceChoices: list[str]
    sampleAvailable: bool
    reports: list[ReportSummary]


class ValidateScansRequest(BaseModel):
    inputDir: str = ""
    recursive: bool = False
    scanPaths: list[str] | None = None


class ValidateOutputRequest(BaseModel):
    outputDir: str


class SelectDirectoryRequest(BaseModel):
    initialDir: str | None = None
    title: str = "Select folder"


class SelectDirectoryResponse(BaseModel):
    selected: bool
    path: str | None = None
    message: str | None = None


class SelectFilesResponse(BaseModel):
    selected: bool
    paths: list[str] = []
    message: str | None = None


class ScanProblem(BaseModel):
    path: str
    name: str
    error: str


class ScanInfo(BaseModel):
    path: str
    name: str
    spacing: str


class ValidateScansResponse(BaseModel):
    exists: bool
    scanCount: int
    readableCount: int
    scans: list[ScanInfo]
    problems: list[ScanProblem]


class ValidateOutputResponse(BaseModel):
    path: str
    exists: bool
    isDirectory: bool
    parentExists: bool
    canCreate: bool
    canWrite: bool
    status: ValidationStatus
    message: str


class RunRequest(BaseModel):
    inputDir: str = ""
    outputDir: str
    recursive: bool = False
    deviceChoice: str = "auto"
    scanPaths: list[str] | None = None


class RunCreated(BaseModel):
    runId: str


class RunStatus(BaseModel):
    runId: str
    state: RunState
    inputDir: str
    outputDir: str
    recursive: bool
    device: str
    latestEvent: dict[str, Any] | None
    logs: list[str]
    reportId: str | None = None
    artifacts: dict[str, bool]
    error: str | None = None


class ReportRow(BaseModel):
    filename: str = ""
    path: str = ""
    subject_id: str = ""
    input_spacing_mm: str = ""
    segmentation_spacing_mm: str = ""
    voxel_count: Any = ""
    volume_mm3: Any = ""
    volume_ml: Any = ""
    status: str = ""
    error: str = ""


class ScanMeta(BaseModel):
    subject: str
    filename: str
    spacing: str


class Metric(BaseModel):
    label: str
    value: float | None
    unit: str
    sub: str


class StructureVolume(BaseModel):
    structure: str
    group: str
    leftMl: float | None
    rightMl: float | None
    totalMl: float | None
    asymmetryPct: float | None


class AtlasRegion(BaseModel):
    key: str
    name: str
    group: str
    labels: list[int]


class AtlasResponse(BaseModel):
    maxLabel: int
    regions: list[AtlasRegion]


class ReportMetadata(BaseModel):
    modified: float
    source: ReportSource
    inputDir: str | None = None
    outputDir: str
    reportPath: str
    device: str | None = None
    runState: RunState | None = None
    runId: str | None = None
    temporary: bool = False


class QcScan(BaseModel):
    subject: str
    filename: str
    status: str
    color: str | None = None
    anat: str | None = None
    seg: str | None = None


class ReportDetail(BaseModel):
    id: str
    summary: ReportSummary
    metadata: ReportMetadata
    scan: ScanMeta
    rows: list[ReportRow]
    metrics: list[Metric]
    structures: list[StructureVolume]
    qc: list[QcScan] = []
    artifacts: dict[str, str | None]


def default_device() -> str:
    if platform.system() == "Darwin" and platform.machine() in {"arm64", "aarch64"}:
        return "mps"
    return "cpu"


def resolved_device(choice: str) -> str:
    return default_device() if choice == "auto" else choice


def report_id(path: Path) -> str:
    resolved = path.expanduser().resolve()
    try:
        raw = str(resolved.relative_to(REPO_ROOT))
    except ValueError:
        raw = str(resolved)
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def report_path_from_id(identifier: str) -> Path:
    padded = identifier + ("=" * (-len(identifier) % 4))
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except Exception as exc:  # noqa: BLE001 - API validation
        raise HTTPException(status_code=404, detail="Unknown report") from exc
    path = (REPO_ROOT / raw).resolve() if not Path(raw).is_absolute() else Path(raw).resolve()
    outputs_root = (REPO_ROOT / "outputs").resolve()
    if outputs_root not in path.parents and not is_known_run_report(path):
        raise HTTPException(status_code=404, detail="Unknown report")
    if path.name.startswith("."):
        raise HTTPException(status_code=404, detail="Unknown report")
    if path.parent.name != "reports" or not path.name.startswith("brain_volumes_") or path.suffix != ".xlsx":
        raise HTTPException(status_code=404, detail="Unknown report")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    return path


def safe_subject(subject: str) -> str:
    """Reject subject identifiers that could traverse outside the report's
    output directory. Subjects are interpolated straight into filesystem paths
    by the QC/volume routes, so a value containing a path separator or ``..``
    must never be accepted."""
    if "/" in subject or "\\" in subject or ".." in subject:
        raise HTTPException(status_code=400, detail="Invalid subject")
    return subject


def is_under_outputs(path: Path) -> bool:
    outputs_root = (REPO_ROOT / "outputs").resolve()
    resolved = path.expanduser().resolve()
    return resolved == outputs_root or outputs_root in resolved.parents


def report_summary(path: Path, source: ReportSource = "saved") -> ReportSummary:
    output_dir = path.parent.parent
    return ReportSummary(
        id=report_id(path),
        name=path.name,
        outputDir=display_path(output_dir),
        reportPath=display_path(path),
        modified=path.stat().st_mtime,
        source=source,
        temporary=source == "current_run",
    )


def recent_reports(root: Path = REPO_ROOT / "outputs") -> list[Path]:
    if not root.exists():
        return []
    return sorted(root.glob("**/reports/brain_volumes_*.xlsx"), key=lambda path: path.stat().st_mtime, reverse=True)


def current_run_reports() -> list[Path]:
    with RUNS_LOCK:
        records = list(RUNS.values())
    paths: list[Path] = []
    for record in records:
        with record.lock:
            if record.report_path is not None and record.report_path.exists():
                paths.append(record.report_path.resolve())
    return paths


def available_reports() -> list[ReportSummary]:
    items: dict[Path, ReportSource] = {}
    for path in recent_reports():
        items[path.resolve()] = "saved"
    for path in current_run_reports():
        items.setdefault(path.resolve(), "saved" if is_under_outputs(path) else "current_run")
    summaries = [report_summary(path, source) for path, source in items.items()]
    return sorted(summaries, key=lambda summary: summary.modified, reverse=True)


def user_path(text: str) -> Path:
    return Path(text.strip()).expanduser().resolve()


def picker_initial_path(initial_dir: str | None) -> Path:
    if initial_dir and initial_dir.strip():
        candidate = Path(initial_dir).expanduser()
        if candidate.exists():
            return candidate.resolve() if candidate.is_dir() else candidate.parent.resolve()
    if DEFAULT_INPUT_DIR.exists():
        return DEFAULT_INPUT_DIR.resolve()
    return Path.home().resolve()


def applescript_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def select_directory_macos(initial: Path, title: str) -> Path | None:
    script = "\n".join(
        [
            f'set defaultFolder to POSIX file "{applescript_text(str(initial))}"',
            f'set selectedFolder to choose folder with prompt "{applescript_text(title)}" default location defaultFolder',
            "POSIX path of selectedFolder",
        ]
    )
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        error = result.stderr.strip()
        if "User canceled" in error or "cancel" in error.lower():
            return None
        raise RuntimeError(error or "Could not open folder picker.")
    selected = result.stdout.strip()
    return Path(selected).expanduser().resolve() if selected else None


def select_directory_tk(initial: Path, title: str) -> Path | None:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    try:
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(initialdir=str(initial), title=title, mustexist=True)
    finally:
        root.destroy()
    return Path(selected).expanduser().resolve() if selected else None


def select_directory(initial_dir: str | None = None, title: str = "Select folder") -> Path | None:
    initial = picker_initial_path(initial_dir)
    if platform.system() == "Darwin":
        return select_directory_macos(initial, title)
    try:
        return select_directory_tk(initial, title)
    except Exception as tk_exc:  # noqa: BLE001 - surface a clear API error without crashing the server
        raise RuntimeError(f"Could not open folder picker: {tk_exc}") from tk_exc


def select_files_macos(initial: Path, title: str) -> list[str]:
    script = "\n".join(
        [
            f'set defaultFolder to POSIX file "{applescript_text(str(initial))}"',
            f'set chosenFiles to choose file with prompt "{applescript_text(title)}" default location defaultFolder with multiple selections allowed',
            'set output to ""',
            "repeat with f in chosenFiles",
            "    set output to output & POSIX path of f & linefeed",
            "end repeat",
            "return output",
        ]
    )
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        error = result.stderr.strip()
        if "User canceled" in error or "cancel" in error.lower():
            return []
        raise RuntimeError(error or "Could not open file picker.")
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return [str(Path(line).expanduser().resolve()) for line in lines]


def select_files_tk(initial: Path, title: str) -> list[str]:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    try:
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askopenfilenames(
            initialdir=str(initial),
            title=title,
            filetypes=[("NIfTI scans", "*.nii *.nii.gz"), ("All files", "*.*")],
        )
    finally:
        root.destroy()
    return [str(Path(item).expanduser().resolve()) for item in selected]


def select_files(initial_dir: str | None = None, title: str = "Select scans") -> list[str]:
    initial = picker_initial_path(initial_dir)
    if platform.system() == "Darwin":
        return select_files_macos(initial, title)
    try:
        return select_files_tk(initial, title)
    except Exception as tk_exc:  # noqa: BLE001 - surface a clear API error without crashing the server
        raise RuntimeError(f"Could not open file picker: {tk_exc}") from tk_exc


def validate_scan_folder(input_dir: Path, recursive: bool) -> ValidateScansResponse:
    if not input_dir.is_dir():
        return ValidateScansResponse(exists=False, scanCount=0, readableCount=0, scans=[], problems=[])
    if not os.access(input_dir, os.R_OK | os.X_OK):
        return ValidateScansResponse(
            exists=True,
            scanCount=0,
            readableCount=0,
            scans=[],
            problems=[
                ScanProblem(
                    path=display_path(input_dir),
                    name=input_dir.name or display_path(input_dir),
                    error="Input folder is not readable.",
                )
            ],
        )
    scans = find_scans(input_dir, recursive)
    readable: list[ScanInfo] = []
    problems: list[ScanProblem] = []
    for scan in scans:
        try:
            spacing = " x ".join(f"{value:g}" for value in read_spacing(scan))
            readable.append(ScanInfo(path=display_path(scan), name=scan.name, spacing=spacing))
        except Exception as exc:  # noqa: BLE001 - diagnostics for user-selected scans
            problems.append(ScanProblem(path=display_path(scan), name=scan.name, error=str(exc)))
    return ValidateScansResponse(
        exists=True,
        scanCount=len(scans),
        readableCount=len(readable),
        scans=readable,
        problems=problems,
    )


def require_runnable_scan_folder(input_dir: Path, recursive: bool) -> None:
    validation = validate_scan_folder(input_dir, recursive)
    if not validation.exists:
        raise HTTPException(status_code=400, detail=f"Scan folder not found: {display_path(input_dir)}")
    if validation.problems and validation.scanCount == 0:
        raise HTTPException(status_code=400, detail=validation.problems[0].error)
    if validation.scanCount == 0:
        raise HTTPException(status_code=400, detail=f"No .nii or .nii.gz scans were found in {display_path(input_dir)}")
    if validation.readableCount == 0:
        raise HTTPException(status_code=400, detail="No readable scans were found. Check the input files and voxel spacing.")
    if validation.problems:
        raise HTTPException(status_code=400, detail=f"Fix {len(validation.problems)} unreadable scan(s) before running analysis.")


def scan_paths_from_request(values: list[str] | None) -> list[Path]:
    if not values:
        return []
    ordered: list[Path] = []
    seen: set[Path] = set()
    for value in values:
        if not value or not value.strip():
            continue
        resolved = Path(value).expanduser().resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        ordered.append(resolved)
    return ordered


def common_input_dir(paths: list[Path]) -> Path:
    if not paths:
        return DEFAULT_INPUT_DIR.resolve() if DEFAULT_INPUT_DIR.exists() else Path.home().resolve()
    if len(paths) == 1:
        return paths[0].parent
    try:
        return Path(os.path.commonpath([str(path) for path in paths]))
    except ValueError:
        return paths[0].parent


def is_scan_file(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith(".nii") or name.endswith(".nii.gz")


def validate_scan_files(paths: list[Path]) -> ValidateScansResponse:
    readable: list[ScanInfo] = []
    problems: list[ScanProblem] = []
    for scan in paths:
        name = scan.name
        if not scan.exists():
            problems.append(ScanProblem(path=display_path(scan), name=name, error="File not found."))
            continue
        if not scan.is_file():
            problems.append(ScanProblem(path=display_path(scan), name=name, error="Not a file."))
            continue
        if not is_scan_file(scan):
            problems.append(ScanProblem(path=display_path(scan), name=name, error="Not a .nii or .nii.gz scan."))
            continue
        try:
            spacing = " x ".join(f"{value:g}" for value in read_spacing(scan))
            readable.append(ScanInfo(path=display_path(scan), name=name, spacing=spacing))
        except Exception as exc:  # noqa: BLE001 - diagnostics for user-selected scans
            problems.append(ScanProblem(path=display_path(scan), name=name, error=str(exc)))
    return ValidateScansResponse(
        exists=bool(paths),
        scanCount=len(paths),
        readableCount=len(readable),
        scans=readable,
        problems=problems,
    )


def require_runnable_scan_files(paths: list[Path]) -> None:
    if not paths:
        raise HTTPException(status_code=400, detail="Select at least one .nii or .nii.gz scan file.")
    validation = validate_scan_files(paths)
    if validation.readableCount == 0:
        raise HTTPException(status_code=400, detail="No readable scans were selected. Check the files and voxel spacing.")
    if validation.problems:
        raise HTTPException(status_code=400, detail=f"Fix {len(validation.problems)} unreadable scan(s) before running analysis.")


def nearest_existing_parent(path: Path) -> Path | None:
    current = path.parent
    while True:
        if current.exists():
            return current
        if current.parent == current:
            return None
        current = current.parent


def validate_output_folder(output_dir_text: str) -> ValidateOutputResponse:
    text = output_dir_text.strip()
    if not text:
        return ValidateOutputResponse(
            path="",
            exists=False,
            isDirectory=False,
            parentExists=False,
            canCreate=False,
            canWrite=False,
            status="error",
            message="Enter a results folder.",
        )

    output_dir = user_path(text)
    exists = output_dir.exists()
    is_directory = output_dir.is_dir()
    parent_exists = output_dir.parent.exists()

    if exists and not is_directory:
        return ValidateOutputResponse(
            path=display_path(output_dir),
            exists=True,
            isDirectory=False,
            parentExists=parent_exists,
            canCreate=False,
            canWrite=False,
            status="error",
            message="Results path exists but is not a folder.",
        )

    if exists:
        can_write = os.access(output_dir, os.W_OK | os.X_OK)
        return ValidateOutputResponse(
            path=display_path(output_dir),
            exists=True,
            isDirectory=True,
            parentExists=parent_exists,
            canCreate=False,
            canWrite=can_write,
            status="ok" if can_write else "error",
            message="Results folder is writable." if can_write else "Results folder is not writable.",
        )

    ancestor = nearest_existing_parent(output_dir)
    if ancestor is not None and not ancestor.is_dir():
        return ValidateOutputResponse(
            path=display_path(output_dir),
            exists=False,
            isDirectory=False,
            parentExists=parent_exists,
            canCreate=False,
            canWrite=False,
            status="error",
            message="A parent path exists but is not a folder.",
        )

    can_create = bool(ancestor and os.access(ancestor, os.W_OK | os.X_OK))
    direct_parent_ready = output_dir.parent.exists() and output_dir.parent.is_dir()
    if can_create:
        message = "Results folder will be created." if direct_parent_ready else "Results folder and missing parent folders will be created."
    else:
        message = "Results folder cannot be created. Check the parent folder permissions."
    return ValidateOutputResponse(
        path=display_path(output_dir),
        exists=False,
        isDirectory=False,
        parentExists=parent_exists,
        canCreate=can_create,
        canWrite=can_create,
        status="ok" if can_create else "error",
        message=message,
    )


def create_output_folder(output_dir_text: str) -> ValidateOutputResponse:
    validation = validate_output_folder(output_dir_text)
    if validation.status != "ok":
        return validation

    output_dir = user_path(output_dir_text)
    if not output_dir.exists():
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return ValidateOutputResponse(
                path=display_path(output_dir),
                exists=output_dir.exists(),
                isDirectory=output_dir.is_dir(),
                parentExists=output_dir.parent.exists(),
                canCreate=False,
                canWrite=False,
                status="error",
                message=f"Could not create results folder: {exc}",
            )
    return validate_output_folder(str(output_dir))


def runnable_output_path(output_dir_text: str) -> Path:
    validation = validate_output_folder(output_dir_text)
    if validation.status != "ok" or not validation.canWrite:
        raise HTTPException(status_code=400, detail=validation.message)
    return user_path(output_dir_text)


def example_segmentation_path(output_dir: Path) -> Path:
    return output_dir / "example_segmentation.mgz"


def scan_info_from_report(df: pd.DataFrame) -> ScanMeta:
    rows = df[df["status"].astype(str) == "ok"] if "status" in df else df
    if rows.empty:
        rows = df
    if rows.empty:
        return ScanMeta(subject="-", filename="-", spacing="-")
    row = rows.iloc[0]
    spacing = str(row.get("input_spacing_mm") or "").strip()
    raw_name = str(row.get("filename") or "").strip()
    label = strip_nii_suffix(Path(raw_name)) if raw_name else "-"
    subject = str(row.get("subject_id") or "").strip() or label
    return ScanMeta(subject=subject or "-", filename=label or "-", spacing=f"{spacing} mm" if spacing else "-")


def read_report_df(path: Path) -> pd.DataFrame:
    return pd.read_excel(path).reindex(columns=REPORT_COLUMNS).fillna("")


def report_artifacts(output_dir: Path, identifier: str) -> dict[str, str | None]:
    color = output_dir / "example_qc_color.png"
    seg = example_segmentation_path(output_dir)
    return {
        "xlsx": f"/api/reports/{identifier}/download/xlsx",
        "pdf": f"/api/reports/{identifier}/download/pdf" if seg.exists() else None,
        "color": f"/api/reports/{identifier}/images/color" if color.exists() else None,
    }


def report_artifact_booleans(report: Path | None) -> dict[str, bool]:
    if report is None:
        return {"xlsx": False, "pdf": False, "color": False}
    output_dir = report.parent.parent
    return {
        "xlsx": report.exists(),
        "pdf": example_segmentation_path(output_dir).exists(),
        "color": (output_dir / "example_qc_color.png").exists(),
    }


def run_context_for_report(path: Path) -> dict[str, str] | None:
    resolved = path.resolve()
    with RUNS_LOCK:
        records = list(RUNS.values())
    for record in records:
        with record.lock:
            if record.report_path is not None and record.report_path.resolve() == resolved:
                return {
                    "runId": record.id,
                    "runState": record.state,
                    "device": record.device,
                    "inputDir": display_path(record.request.inputDir),
                }
    return None


def input_dir_from_rows(df: pd.DataFrame) -> str | None:
    if "path" not in df:
        return None
    parents = {
        display_path(Path(str(value).strip()).expanduser().parent)
        for value in df["path"].tolist()
        if str(value).strip()
    }
    if not parents:
        return None
    if len(parents) == 1:
        return next(iter(parents))
    return "Multiple input folders"


def run_id_from_report(path: Path) -> str:
    # Delegate to the shared helper in run.py so the report-name <-> run_id
    # convention lives in exactly one place and can't drift between the writer
    # (run.py) and this reader.
    return run_id_from_report_path(path)


def build_qc_scans(output_dir: Path, identifier: str, df: pd.DataFrame, report_path: Path | None = None) -> list[QcScan]:
    """One QC entry per scan in the report, each pointing at its own montage."""
    qc_dir = output_dir / "qc"
    run_id = run_id_from_report(report_path) if report_path is not None else None
    fastsurfer_dir = output_dir / "runs" / run_id / "fastsurfer" if run_id else None
    scans: list[QcScan] = []
    for record in df.to_dict(orient="records"):
        subject = str(record.get("subject_id") or "").strip()
        raw_name = str(record.get("filename") or "").strip()
        filename = strip_nii_suffix(Path(raw_name)) if raw_name else (subject or "-")
        status = str(record.get("status") or "").strip() or "unknown"
        color = None
        if subject and (qc_dir / f"{subject}_color.png").exists():
            color = f"/api/reports/{identifier}/qc/{quote(subject, safe='')}"
        anat = None
        seg = None
        if subject and fastsurfer_dir is not None:
            mri = fastsurfer_dir / subject / "mri"
            quoted = quote(subject, safe="")
            if (mri / "orig.mgz").exists():
                anat = f"/api/reports/{identifier}/volume/{quoted}/anat"
            if (mri / SEGMENTATION_NAME).exists():
                seg = f"/api/reports/{identifier}/volume/{quoted}/seg"
        scans.append(QcScan(subject=subject or filename or "-", filename=filename or "-", status=status, color=color, anat=anat, seg=seg))
    # Back-compat: older reports only saved a single example_qc_color.png.
    if scans and not any(scan.color for scan in scans) and (output_dir / "example_qc_color.png").exists():
        target = next((scan for scan in scans if scan.status == "ok"), scans[0])
        target.color = f"/api/reports/{identifier}/images/color"
    return scans


def build_report_detail(path: Path) -> ReportDetail:
    identifier = report_id(path)
    output_dir = path.parent.parent
    source: ReportSource = "current_run" if not is_under_outputs(path) and is_known_run_report(path) else "saved"
    df = read_report_df(path)
    scan = scan_info_from_report(df)
    rows = [ReportRow(**{key: row.get(key, "") for key in REPORT_COLUMNS}) for row in df.to_dict(orient="records")]
    run_context = run_context_for_report(path)
    summary = report_summary(path, source)
    metadata = ReportMetadata(
        modified=path.stat().st_mtime,
        source=source,
        inputDir=run_context["inputDir"] if run_context else input_dir_from_rows(df),
        outputDir=summary.outputDir,
        reportPath=summary.reportPath,
        device=run_context["device"] if run_context else None,
        runState=run_context["runState"] if run_context else None,
        runId=run_context["runId"] if run_context else None,
        temporary=summary.temporary,
    )
    metrics = [
        Metric(label="Brain parenchyma", value=None, unit="mL", sub="Whole brain minus CSF / ventricles"),
        Metric(label="Total segmented", value=None, unit="mL", sub="All labelled tissue"),
        Metric(label="Ventricular volume", value=None, unit="mL", sub="Lateral + 3rd + 4th"),
    ]
    structures: list[StructureVolume] = []
    seg = example_segmentation_path(output_dir)
    if seg.exists():
        totals = brain_totals(seg)
        metrics = [
            Metric(label="Brain parenchyma", value=totals.get("parenchyma_ml"), unit="mL", sub="Whole brain minus CSF / ventricles"),
            Metric(label="Total segmented", value=totals.get("total_brain_ml"), unit="mL", sub="All labelled tissue"),
            Metric(label="Ventricular volume", value=totals.get("ventricular_ml"), unit="mL", sub="Lateral + 3rd + 4th"),
        ]
        sdf = structure_volumes(seg)
        structures = [
            StructureVolume(
                structure=str(row["structure"]),
                group=str(row["group"]),
                leftMl=None if pd.isna(row["left_ml"]) else float(row["left_ml"]),
                rightMl=None if pd.isna(row["right_ml"]) else float(row["right_ml"]),
                totalMl=None if pd.isna(row["total_ml"]) else float(row["total_ml"]),
                asymmetryPct=None if pd.isna(row["asymmetry_pct"]) else float(row["asymmetry_pct"]),
            )
            for _, row in sdf.iterrows()
        ]
    return ReportDetail(
        id=identifier,
        summary=summary,
        metadata=metadata,
        scan=scan,
        rows=rows,
        metrics=metrics,
        structures=structures,
        qc=build_qc_scans(output_dir, identifier, df, report_path=path),
        artifacts=report_artifacts(output_dir, identifier),
    )


def compose_run_config(
    input_dir: Path,
    output_dir: Path,
    recursive: bool,
    device_choice: str,
    scan_paths: list[str] | None = None,
):
    with initialize_config_dir(version_base=None, config_dir=str(CONFIG_DIR)):
        cfg = compose(config_name="config")
    device = resolved_device(device_choice)
    cfg.input_dir = str(input_dir)
    cfg.output_dir = str(output_dir)
    cfg.recursive = recursive
    cfg.scan_paths = list(scan_paths) if scan_paths else None
    cfg.quiet = True
    cfg.fastsurfer.device = device
    cfg.fastsurfer.python = sys.executable
    if BUNDLED_FASTSURFER.exists():
        cfg.fastsurfer.home = str(BUNDLED_FASTSURFER.parent)
    if device == "mps":
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    return cfg


@dataclass
class RunRecord:
    id: str
    request: RunRequest
    device: str
    state: RunState = "queued"
    report_path: Path | None = None
    error: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)
    control: RunControl = field(default_factory=RunControl)
    lock: threading.Lock = field(default_factory=threading.Lock)
    condition: threading.Condition = field(default_factory=threading.Condition)

    def append_event(self, event: str, payload: dict[str, Any] | None = None) -> None:
        item = {"event": event, "payload": payload or {}}
        message = str((payload or {}).get("message") or "")
        with self.lock:
            self.events.append(item)
            if message:
                self.logs.append(message)
                self.logs = self.logs[-100:]
        with self.condition:
            self.condition.notify_all()

    def status(self) -> RunStatus:
        with self.lock:
            latest = self.events[-1] if self.events else None
            report = self.report_path
            return RunStatus(
                runId=self.id,
                state=self.state,
                inputDir=self.request.inputDir,
                outputDir=self.request.outputDir,
                recursive=self.request.recursive,
                device=self.device,
                latestEvent=latest,
                logs=list(self.logs),
                reportId=report_id(report) if report else None,
                artifacts=report_artifact_booleans(report),
                error=self.error,
            )


RUNS: dict[str, RunRecord] = {}
RUNS_LOCK = threading.Lock()


def is_known_run_report(path: Path) -> bool:
    with RUNS_LOCK:
        records = list(RUNS.values())
    for record in records:
        with record.lock:
            if record.report_path is not None and record.report_path.resolve() == path:
                return True
    return False


def run_worker(record: RunRecord) -> None:
    try:
        with record.lock:
            record.state = "running"
        record.append_event("start", {"message": "Run started."})
        cfg = compose_run_config(
            Path(record.request.inputDir).expanduser(),
            Path(record.request.outputDir).expanduser(),
            record.request.recursive,
            record.request.deviceChoice,
            scan_paths=record.request.scanPaths,
        )

        def progress(event: str, payload: dict[str, Any] | None = None) -> None:
            if event == "complete":
                record.append_event("analysis_summary", payload)
                return
            record.append_event(event, payload)

        report = run_analysis(cfg, progress=progress, control=record.control)
        report_path = Path(report)
        with record.lock:
            record.report_path = report_path
            record.state = "complete"
        identifier = report_id(report_path)
        record.append_event(
            "report_written",
            {"message": f"Report written: {display_path(report_path)}", "reportId": identifier},
        )
        record.append_event("complete", {"message": "Analysis complete.", "reportId": identifier})
    except RunCancelled:
        with record.lock:
            record.state = "cancelled"
            record.error = "Run cancelled."
        record.append_event("cancelled", {"message": "Run cancelled."})
    except Exception as exc:  # noqa: BLE001 - surface backend failures to UI
        with record.lock:
            record.state = "error"
            record.error = str(exc)
        record.append_event("error", {"message": str(exc)})


def create_app() -> FastAPI:
    app = FastAPI(title="Volumetric Analysis")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/defaults", response_model=DefaultsResponse)
    def defaults() -> DefaultsResponse:
        return DefaultsResponse(
            inputDir=display_path(DEFAULT_INPUT_DIR),
            outputDir=display_path(DEFAULT_OUTPUT_DIR),
            recursive=False,
            defaultDevice=default_device(),
            deviceChoices=["auto", "cpu", "mps", "cuda"],
            sampleAvailable=DEFAULT_TUTORIAL_SCAN.exists(),
            reports=available_reports(),
        )

    @app.post("/api/scans/validate", response_model=ValidateScansResponse)
    def validate_scans(request: ValidateScansRequest) -> ValidateScansResponse:
        scan_paths = scan_paths_from_request(request.scanPaths)
        if scan_paths:
            return validate_scan_files(scan_paths)
        if not request.inputDir.strip():
            return ValidateScansResponse(exists=False, scanCount=0, readableCount=0, scans=[], problems=[])
        input_dir = user_path(request.inputDir)
        return validate_scan_folder(input_dir, request.recursive)

    @app.post("/api/output/validate", response_model=ValidateOutputResponse)
    def validate_output(request: ValidateOutputRequest) -> ValidateOutputResponse:
        return validate_output_folder(request.outputDir)

    @app.post("/api/output/create", response_model=ValidateOutputResponse)
    def create_output(request: ValidateOutputRequest) -> ValidateOutputResponse:
        return create_output_folder(request.outputDir)

    @app.post("/api/paths/select-directory", response_model=SelectDirectoryResponse)
    def select_directory_route(request: SelectDirectoryRequest) -> SelectDirectoryResponse:
        try:
            selected = select_directory(request.initialDir, request.title)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if selected is None:
            return SelectDirectoryResponse(selected=False, message="Folder selection canceled.")
        return SelectDirectoryResponse(selected=True, path=display_path(selected))

    @app.post("/api/paths/select-files", response_model=SelectFilesResponse)
    def select_files_route(request: SelectDirectoryRequest) -> SelectFilesResponse:
        try:
            selected = select_files(request.initialDir, request.title)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if not selected:
            return SelectFilesResponse(selected=False, paths=[], message="File selection canceled.")
        return SelectFilesResponse(selected=True, paths=[display_path(Path(path)) for path in selected])

    @app.post("/api/runs", response_model=RunCreated)
    def create_run(request: RunRequest) -> RunCreated:
        scan_paths = scan_paths_from_request(request.scanPaths)
        if scan_paths:
            require_runnable_scan_files(scan_paths)
            input_dir = common_input_dir(scan_paths)
        else:
            if not request.inputDir.strip():
                raise HTTPException(status_code=400, detail="Select scans to analyze.")
            input_dir = user_path(request.inputDir)
            require_runnable_scan_folder(input_dir, request.recursive)
        output_dir = runnable_output_path(request.outputDir)
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise HTTPException(status_code=400, detail=f"Cannot create results folder: {display_path(output_dir)}") from exc
        if not output_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"Results path is not a folder: {display_path(output_dir)}")
        run_id = uuid.uuid4().hex[:12]
        normalized_request = request.model_copy(
            update={
                "inputDir": str(input_dir),
                "outputDir": str(output_dir),
                "scanPaths": [str(path) for path in scan_paths] if scan_paths else None,
            }
        )
        record = RunRecord(id=run_id, request=normalized_request, device=resolved_device(request.deviceChoice))
        with RUNS_LOCK:
            RUNS[run_id] = record
        thread = threading.Thread(target=run_worker, args=(record,), daemon=True)
        thread.start()
        return RunCreated(runId=run_id)

    @app.get("/api/runs/{run_id}", response_model=RunStatus)
    def get_run(run_id: str) -> RunStatus:
        record = RUNS.get(run_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return record.status()

    @app.post("/api/runs/{run_id}/cancel", response_model=RunStatus)
    def cancel_run(run_id: str) -> RunStatus:
        record = RUNS.get(run_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Run not found")
        with record.lock:
            state = record.state
        if state in {"queued", "running"}:
            record.control.cancel()
        return record.status()

    @app.get("/api/runs/{run_id}/events")
    async def run_events(run_id: str) -> StreamingResponse:
        record = RUNS.get(run_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Run not found")

        def wait_for_next_event(index: int) -> int:
            with record.condition:
                record.condition.wait_for(lambda: index < len(record.events), timeout=15)
                return len(record.events)

        async def stream():
            index = 0
            while True:
                while index < len(record.events):
                    item = record.events[index]
                    index += 1
                    yield f"event: {item['event']}\ndata: {json.dumps(item['payload'])}\n\n"
                    if item["event"] in {"complete", "error", "cancelled"}:
                        return
                new_length = await asyncio.to_thread(wait_for_next_event, index)
                if new_length == index:
                    yield ": keep-alive\n\n"
                    continue

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/api/reports", response_model=list[ReportSummary])
    def reports() -> list[ReportSummary]:
        return available_reports()

    @app.get("/api/reports/{identifier}", response_model=ReportDetail)
    def report_detail(identifier: str) -> ReportDetail:
        return build_report_detail(report_path_from_id(identifier))

    @app.get("/api/reports/{identifier}/download/xlsx")
    def download_xlsx(identifier: str) -> FileResponse:
        path = report_path_from_id(identifier)
        return FileResponse(path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    @app.get("/api/reports/{identifier}/download/pdf")
    def download_pdf(identifier: str) -> Response:
        path = report_path_from_id(identifier)
        detail = build_report_detail(path)
        seg = example_segmentation_path(path.parent.parent)
        if not seg.exists():
            raise HTTPException(status_code=404, detail="Segmentation file not found for PDF")
        structures = structure_volumes(seg)
        totals = brain_totals(seg)
        pdf = build_pdf_report(detail.scan.model_dump(), totals, structures)
        stem = detail.scan.subject.replace(" ", "_") or "report"
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="brain_volume_report_{stem}.pdf"'},
        )

    @app.get("/api/reports/{identifier}/images/color")
    def report_image(identifier: str) -> FileResponse:
        path = report_path_from_id(identifier)
        image = path.parent.parent / "example_qc_color.png"
        if not image.exists():
            raise HTTPException(status_code=404, detail="Image not found")
        return FileResponse(image, media_type="image/png")

    @app.get("/api/reports/{identifier}/qc/{subject}")
    def report_qc_image(identifier: str, subject: str) -> FileResponse:
        subject = safe_subject(subject)
        path = report_path_from_id(identifier)
        image = path.parent.parent / "qc" / f"{subject}_color.png"
        if not image.exists():
            raise HTTPException(status_code=404, detail="QC image not found")
        return FileResponse(image, media_type="image/png")

    @app.get("/api/reports/{identifier}/volume/{subject}/{kind}")
    def report_volume(identifier: str, subject: str, kind: str) -> FileResponse:
        if kind not in {"anat", "seg"}:
            raise HTTPException(status_code=404, detail="Unknown volume kind")
        subject = safe_subject(subject)
        path = report_path_from_id(identifier)
        output_dir = path.parent.parent
        run_id = run_id_from_report(path)
        mri = output_dir / "runs" / run_id / "fastsurfer" / subject / "mri"
        if kind == "anat":
            file = mri / "orig.mgz"
            download_name = "orig.mgz"
        else:
            file = mri / SEGMENTATION_NAME
            download_name = "seg.mgz"
        if not file.exists():
            raise HTTPException(status_code=404, detail="Volume not found")
        return FileResponse(file, media_type="application/octet-stream", filename=download_name)

    @app.get("/api/atlas/regions", response_model=AtlasResponse)
    def atlas() -> AtlasResponse:
        return AtlasResponse(
            maxLabel=MAX_LABEL,
            regions=[AtlasRegion(**region) for region in atlas_regions()],
        )

    @app.get("/api/checks")
    def checks() -> list[dict[str, str]]:
        return [check.__dict__ for check in run_checks()]

    if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app


app = create_app()


def browser_url(host: str, port: int) -> str:
    display_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    return f"http://{display_host}:{port}"


def port_available(host: str, port: int) -> bool:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def build_frontend() -> None:
    frontend_dir = REPO_ROOT / "frontend"
    package_json = frontend_dir / "package.json"
    if not package_json.exists():
        raise SystemExit(f"Frontend package not found: {package_json}")
    print("Building React frontend...")
    try:
        result = subprocess.run(["npm", "--prefix", str(frontend_dir), "run", "build"], cwd=str(REPO_ROOT), check=False)
    except FileNotFoundError as exc:
        raise SystemExit("npm was not found. Install Node.js/npm before launching the web UI.") from exc
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def open_browser_after_start(url: str) -> None:
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the Volumetric Analysis web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--build", action="store_true", help="Build frontend/dist before starting the server.")
    parser.add_argument("--open", action="store_true", help="Open the local web UI in the default browser.")
    args = parser.parse_args(argv)

    if not port_available(args.host, args.port):
        url = browser_url(args.host, args.port)
        raise SystemExit(f"Port {args.port} is already in use on {args.host}. Stop the existing server, open {url}, or pass --port with a free port.")

    if args.build:
        build_frontend()

    url = browser_url(args.host, args.port)
    if args.open:
        open_browser_after_start(url)
    print(f"Volumetric Analysis UI: {url}")

    import uvicorn

    target = "volumetric_analysis.web:app" if args.reload else create_app()
    uvicorn.run(target, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
