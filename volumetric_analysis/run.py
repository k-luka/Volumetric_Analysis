from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

import hydra
import nibabel as nib
import numpy as np
import pandas as pd
from omegaconf import DictConfig


SEGMENTATION_NAME = "aparc.DKTatlas+aseg.deep.mgz"
REPORT_COLUMNS = [
    "filename",
    "path",
    "subject_id",
    "input_spacing_mm",
    "segmentation_spacing_mm",
    "voxel_count",
    "volume_mm3",
    "volume_ml",
    "status",
    "error",
]

ProgressCallback = Callable[[str, dict[str, object] | None], None]

# Reports are named "<prefix>_<run_id>.xlsx" where run_id is a
# "%Y%m%d_%H%M%S" timestamp (two underscore-separated segments). The helpers
# below are the single source of truth for that convention so run.py (which
# writes reports) and web.py (which reverse-maps a report back to its run
# directory) can never drift.
RUN_ID_FORMAT = "%Y%m%d_%H%M%S"


def new_run_id() -> str:
    """Return a fresh run identifier for the current time."""
    return datetime.now().strftime(RUN_ID_FORMAT)


def report_filename(prefix: str, run_id: str) -> str:
    """Build the report file name for a run from its prefix and run_id."""
    return f"{prefix}_{run_id}.xlsx"


def run_id_from_report_path(path: Path) -> str:
    """Recover the run_id from a report path written by ``report_filename``.

    The run_id is the trailing two underscore-separated segments of the file
    stem (the "%Y%m%d_%H%M%S" timestamp), regardless of the prefix.
    """
    return "_".join(path.stem.split("_")[-2:])


def display_path(path: object) -> str:
    """Return the shortest readable form of a path: relative to the current
    directory, relative to home (~), or absolute - whichever is shortest."""
    p = Path(str(path))
    candidates = [str(p)]
    for base, prefix in ((Path.cwd(), ""), (Path.home(), "~/")):
        try:
            candidates.append(prefix + str(p.relative_to(base)))
        except ValueError:
            pass
    return min(candidates, key=len)


def find_scans(input_dir: Path, recursive: bool) -> list[Path]:
    finder = input_dir.rglob if recursive else input_dir.glob
    scans = list(finder("*.nii")) + list(finder("*.nii.gz"))
    return sorted({scan.resolve() for scan in scans})


def strip_nii_suffix(path: Path) -> str:
    name = path.name
    if name.endswith(".nii.gz"):
        return name[:-7]
    if name.endswith(".nii"):
        return name[:-4]
    return path.stem


def subject_id_from_filename(path: Path) -> str:
    subject_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", strip_nii_suffix(path))
    return subject_id.strip("._-") or "scan"


def unique_subject_ids(scans: list[Path]) -> dict[Path, str]:
    used: dict[str, int] = {}
    result: dict[Path, str] = {}
    for scan in scans:
        base = subject_id_from_filename(scan)
        count = used.get(base, 0) + 1
        used[base] = count
        result[scan] = base if count == 1 else f"{base}_{count}"
    return result


def read_spacing(path: Path) -> tuple[float, float, float]:
    image = nib.load(str(path))
    spacing = tuple(float(value) for value in image.header.get_zooms()[:3])
    if len(spacing) != 3 or any(not np.isfinite(value) or value <= 0 for value in spacing):
        raise ValueError(f"Invalid voxel spacing in {path}")
    return spacing


def spacing_text(spacing: tuple[float, float, float] | None) -> str:
    if spacing is None:
        return ""
    return " x ".join(f"{value:g}" for value in spacing)


def optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"none", "null"}:
        return None
    return text


def progress_message(callback: ProgressCallback | None, event: str, **payload: object) -> None:
    if callback is not None:
        callback(event, payload)


def resolved_fastsurfer_python(cfg: DictConfig) -> str:
    configured = optional_text(cfg.fastsurfer.get("python"))
    if configured is None or configured.lower() == "auto":
        return sys.executable
    return configured


def ensure_fastsurfer(cfg: DictConfig) -> Path | None:
    if fastsurfer_executable(cfg) is not None:
        return None

    home = Path(str(cfg.fastsurfer.home)).expanduser().resolve()
    runner = home / "run_fastsurfer.sh"
    if runner.exists():
        return home

    if not cfg.fastsurfer.install_if_missing:
        raise FileNotFoundError(f"FastSurfer was not found at {home}")
    if home.exists():
        raise FileNotFoundError(f"{home} exists but run_fastsurfer.sh was not found")

    home.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "git",
            "clone",
            "--branch",
            str(cfg.fastsurfer.branch),
            str(cfg.fastsurfer.repo_url),
            str(home),
        ],
        check=True,
    )
    if cfg.fastsurfer.install_requirements:
        requirements_path = home / str(cfg.fastsurfer.requirements_file)
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", str(requirements_path)],
            check=True,
        )
    return home


def fastsurfer_executable(cfg: DictConfig) -> str | None:
    executable = optional_text(cfg.fastsurfer.get("executable"))
    if executable is None:
        return None

    path = Path(executable).expanduser()
    if path.is_absolute() or os.sep in executable:
        if not path.exists():
            raise FileNotFoundError(f"FastSurfer executable was not found: {path}")
        return str(path.resolve())

    resolved = shutil.which(executable)
    if resolved is None:
        raise FileNotFoundError(f"FastSurfer executable was not found on PATH: {executable}")
    return resolved


def build_fastsurfer_command(
    scan: Path,
    subject_id: str,
    subjects_dir: Path,
    cfg: DictConfig,
) -> list[str]:
    executable = fastsurfer_executable(cfg)
    if executable is None:
        home = Path(str(cfg.fastsurfer.home)).expanduser().resolve()
        executable = str(home / "run_fastsurfer.sh")

    command = [
        executable,
        "--t1",
        str(scan),
        "--sd",
        str(subjects_dir),
        "--sid",
        subject_id,
        "--seg_only",
        "--py",
        resolved_fastsurfer_python(cfg),
    ]
    if cfg.fastsurfer.allow_root:
        command.append("--allow_root")

    device = optional_text(cfg.fastsurfer.get("device"))
    if device:
        command.extend(["--device", device])

    viewagg_device = optional_text(cfg.fastsurfer.get("viewagg_device"))
    if viewagg_device:
        command.extend(["--viewagg_device", viewagg_device])

    command.extend(str(arg) for arg in (cfg.fastsurfer.get("extra_args") or []))
    return command


class RunCancelled(Exception):
    """Raised inside the engine when a run is cancelled by the caller."""


def _descendant_pids(root_pid: int) -> list[int]:
    """Return every descendant PID of ``root_pid`` (depth-first) via ``ps``."""
    try:
        out = subprocess.run(["ps", "-axo", "pid=,ppid="], capture_output=True, text=True, check=False).stdout
    except OSError:
        return []
    children: dict[int, list[int]] = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        try:
            pid, ppid = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        children.setdefault(ppid, []).append(pid)
    result: list[int] = []
    stack = [root_pid]
    while stack:
        current = stack.pop()
        for child in children.get(current, []):
            result.append(child)
            stack.append(child)
    return result


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _terminate_process_group(process: subprocess.Popen) -> None:
    """Terminate a subprocess and the whole tree of workers it spawned.

    FastSurfer launches its torch/MPS workers in their *own* sessions, so a
    ``killpg`` on the leader's process group alone leaves them running. We
    instead enumerate the full descendant tree, accumulate every PID we ever see
    (children get reparented to launchd once their parent dies, breaking the
    tree links), and escalate SIGTERM -> SIGKILL until nothing is left. PIDs are
    signalled directly with ``os.kill`` so we never reap the child here — the
    engine thread owns ``process.wait()``.
    """
    root = process.pid
    try:
        pgid = os.getpgid(root)
    except OSError:
        pgid = None
    seen: set[int] = {root}

    def sweep(sig: int) -> None:
        seen.update(_descendant_pids(root))
        if pgid is not None:
            try:
                os.killpg(pgid, sig)
            except OSError:
                pass
        for pid in list(seen):
            try:
                os.kill(pid, sig)
            except OSError:
                pass

    sweep(signal.SIGTERM)
    for _ in range(8):  # ~1.6s graceful window (also keeps discovering new workers)
        time.sleep(0.2)
        seen.update(_descendant_pids(root))
        if not any(_pid_alive(pid) for pid in seen):
            return
    for _ in range(15):  # up to ~3s of hard kills for stragglers
        sweep(signal.SIGKILL)
        time.sleep(0.2)
        if not any(_pid_alive(pid) for pid in seen):
            return


class RunControl:
    """Cooperative cancellation handle shared between a front-end and the engine.

    A caller (e.g. the web server) creates one per run, passes it into
    ``run_analysis``, and calls ``cancel()`` from another thread to stop an
    in-flight FastSurfer subprocess. ``run_analysis`` checks ``cancelled``
    between scans and raises ``RunCancelled``.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cancelled = False
        self._process = None

    @property
    def cancelled(self) -> bool:
        with self._lock:
            return self._cancelled

    def cancel(self) -> None:
        with self._lock:
            self._cancelled = True
            process = self._process
        if process is not None and process.poll() is None:
            _terminate_process_group(process)

    def attach(self, process: subprocess.Popen) -> None:
        with self._lock:
            self._process = process
            cancelled = self._cancelled
        # If cancellation arrived between the cancel() check and attach, honor it.
        if cancelled and process.poll() is None:
            _terminate_process_group(process)

    def detach(self) -> None:
        with self._lock:
            self._process = None


def _run_subprocess(command: list[str], env: dict, control: "RunControl | None", **kwargs) -> int:
    # start_new_session gives the child its own process group so a cancel can
    # kill FastSurfer *and* the python workers it spawns.
    process = subprocess.Popen(command, env=env, start_new_session=True, **kwargs)
    if control is not None:
        control.attach(process)
    try:
        return process.wait()
    finally:
        if control is not None:
            control.detach()


def run_fastsurfer(
    scan: Path,
    subject_id: str,
    subjects_dir: Path,
    cfg: DictConfig,
    control: "RunControl | None" = None,
) -> int:
    command = build_fastsurfer_command(scan, subject_id, subjects_dir, cfg)
    env = os.environ.copy()
    if fastsurfer_executable(cfg) is None:
        home = Path(str(cfg.fastsurfer.home)).expanduser().resolve()
        env["FASTSURFER_HOME"] = str(home)

    if bool(cfg.get("quiet", False)):
        # Keep the console clean: send FastSurfer's verbose output to a log file.
        log_path = subjects_dir / f"{subject_id}_fastsurfer.log"
        with open(log_path, "w") as log:
            return _run_subprocess(command, env, control, stdout=log, stderr=subprocess.STDOUT)
    return _run_subprocess(command, env, control)


def compute_volume(segmentation_path: Path) -> tuple[int, tuple[float, float, float], float, float]:
    segmentation = nib.load(str(segmentation_path))
    spacing = tuple(float(value) for value in segmentation.header.get_zooms()[:3])
    if len(spacing) != 3 or any(not np.isfinite(value) or value <= 0 for value in spacing):
        raise ValueError(f"Invalid voxel spacing in {segmentation_path}")

    labels = np.asarray(segmentation.dataobj)
    voxel_count = int(np.count_nonzero(labels))
    volume_mm3 = float(voxel_count * np.prod(spacing))
    volume_ml = volume_mm3 / 1000.0
    return voxel_count, spacing, volume_mm3, volume_ml


def save_example_qc(
    image_path: Path,
    segmentation_path: Path,
    output_path: Path,
    slices: int,
) -> None:
    import matplotlib.pyplot as plt

    image = np.asarray(nib.load(str(image_path)).dataobj, dtype=np.float32)
    labels = np.asarray(nib.load(str(segmentation_path)).dataobj)
    if image.shape != labels.shape:
        raise ValueError("QC image and segmentation shapes do not match")

    slice_count = max(1, int(slices))
    indices = np.linspace(image.shape[2] * 0.2, image.shape[2] * 0.8, slice_count).astype(int)

    cols = min(4, slice_count)
    rows = int(np.ceil(slice_count / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3, rows * 3))
    axes_array = np.atleast_1d(axes).ravel()

    low, high = np.percentile(image, [1, 99])
    image = np.clip((image - low) / max(high - low, 1e-6), 0, 1)

    for axis, index in zip(axes_array, indices):
        axis.imshow(np.rot90(image[:, :, index]), cmap="gray")
        overlay = np.ma.masked_where(labels[:, :, index] == 0, labels[:, :, index])
        axis.imshow(np.rot90(overlay), cmap="tab20", alpha=0.35, interpolation="nearest")
        axis.axis("off")

    for axis in axes_array[len(indices) :]:
        axis.axis("off")

    fig.tight_layout(pad=0.1)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


def save_example_outputs(
    conformed_image_path: Path,
    segmentation_path: Path,
    output_dir: Path,
    cfg: DictConfig,
    subject_id: str,
) -> None:
    # Keep one example segmentation for the PDF + report-level structure table.
    shutil.copy2(segmentation_path, output_dir / str(cfg.qc.segmentation_name))
    if not conformed_image_path.exists():
        return

    # Per-subject QC so a batch can be reviewed scan by scan, not just the last one.
    color_png = output_dir / "qc" / f"{subject_id}_color.png"
    save_example_qc(
        conformed_image_path,
        segmentation_path,
        color_png,
        int(cfg.qc.slices),
    )
    # Keep a single example copy for the legacy report route / older consumers.
    shutil.copy2(color_png, output_dir / str(cfg.qc.color_image_name))


def new_report_row(scan: Path, subject_id: str) -> dict[str, object]:
    return {
        "filename": scan.name,
        "path": str(scan),
        "subject_id": subject_id,
        "input_spacing_mm": "",
        "segmentation_spacing_mm": "",
        "voxel_count": "",
        "volume_mm3": "",
        "volume_ml": "",
        "status": "failed",
        "error": "",
    }


def process_scan(
    scan: Path,
    subject_id: str,
    subjects_dir: Path,
    output_dir: Path,
    cfg: DictConfig,
    control: "RunControl | None" = None,
) -> dict[str, object]:
    row = new_report_row(scan, subject_id)

    try:
        row["input_spacing_mm"] = spacing_text(read_spacing(scan))
    except Exception as exc:
        row["error"] = str(exc)
        return row

    return_code = run_fastsurfer(scan, subject_id, subjects_dir, cfg, control=control)
    if control is not None and control.cancelled:
        raise RunCancelled()
    if return_code != 0:
        row["error"] = f"FastSurfer failed with exit code {return_code}"
        return row

    subject_mri_dir = subjects_dir / subject_id / "mri"
    segmentation_path = subject_mri_dir / SEGMENTATION_NAME
    conformed_image_path = subject_mri_dir / "orig.mgz"
    if not segmentation_path.exists():
        row["error"] = f"Missing segmentation output: {segmentation_path}"
        return row

    try:
        voxel_count, spacing, volume_mm3, volume_ml = compute_volume(segmentation_path)
    except Exception as exc:
        row["error"] = str(exc)
        return row

    row["segmentation_spacing_mm"] = spacing_text(spacing)
    row["voxel_count"] = voxel_count
    row["volume_mm3"] = volume_mm3
    row["volume_ml"] = volume_ml
    row["status"] = "ok"

    if cfg.qc.save_example:
        save_example_outputs(conformed_image_path, segmentation_path, output_dir, cfg, subject_id)

    return row


def write_report(
    rows: list[dict[str, object]],
    output_dir: Path,
    prefix: str,
    run_id: str,
) -> Path:
    reports_dir = output_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_path = reports_dir / report_filename(prefix, run_id)
    pd.DataFrame(rows, columns=REPORT_COLUMNS).to_excel(report_path, index=False)
    return report_path


def run_analysis(cfg: DictConfig, progress: ProgressCallback | None = None, control: "RunControl | None" = None) -> Path:
    """Run the analysis described by ``cfg`` and return the report path.

    This is the engine entry point. Front-ends (the Hydra CLI ``main`` below,
    the interactive wizard, a future UI) all build a config and call this.
    """
    input_dir = Path(str(cfg.input_dir)).expanduser().resolve()
    output_dir = Path(str(cfg.output_dir)).expanduser().resolve()
    run_id = new_run_id()
    subjects_dir = output_dir / "runs" / run_id / "fastsurfer"
    output_dir.mkdir(parents=True, exist_ok=True)
    subjects_dir.mkdir(parents=True, exist_ok=True)

    explicit_paths = list(cfg.get("scan_paths") or [])
    if explicit_paths:
        candidates = sorted({Path(str(value)).expanduser().resolve() for value in explicit_paths})
        scans = [
            scan
            for scan in candidates
            if scan.is_file() and (scan.name.lower().endswith(".nii") or scan.name.lower().endswith(".nii.gz"))
        ]
    else:
        scans = find_scans(input_dir, bool(cfg.recursive))
    if not scans:
        message = f"No .nii or .nii.gz scans were found in {display_path(input_dir)}."
        print(message)
        progress_message(progress, "no_scans", message=message, input_dir=str(input_dir))
        report_path = write_report([], output_dir, str(cfg.report.filename_prefix), run_id)
        progress_message(progress, "report_written", report_path=str(report_path))
        progress_message(
            progress,
            "complete",
            total=0,
            succeeded=0,
            failed=0,
            report_path=str(report_path),
            message="Analyzed 0 scan(s): 0 succeeded, 0 failed.",
        )
        return report_path

    fastsurfer_home = ensure_fastsurfer(cfg)
    if fastsurfer_home is not None:
        cfg.fastsurfer.home = str(fastsurfer_home)

    subject_ids = unique_subject_ids(scans)
    rows: list[dict[str, object]] = []
    total = len(scans)
    print(f"\nAnalyzing {total} scan(s)...\n")
    progress_message(progress, "start", total=total, input_dir=str(input_dir), output_dir=str(output_dir))

    for index, scan in enumerate(scans, start=1):
        if control is not None and control.cancelled:
            raise RunCancelled()
        subject_id = subject_ids[scan]
        start_message = f"[{index}/{total}] {scan.name} - segmenting..."
        print(start_message, flush=True)
        progress_message(
            progress,
            "scan_start",
            index=index,
            total=total,
            scan=str(scan),
            filename=scan.name,
            subject_id=subject_id,
            message=start_message,
        )
        start = time.perf_counter()
        row = process_scan(scan, subject_id, subjects_dir, output_dir, cfg, control=control)
        elapsed = time.perf_counter() - start
        rows.append(row)
        if row["status"] == "ok":
            message = f"        done - {float(row['volume_ml']):,.1f} mL  ({elapsed:.0f}s)"
        else:
            message = f"        failed - {row['error']}"
        print(message)
        progress_message(
            progress,
            "scan_done",
            index=index,
            total=total,
            elapsed=elapsed,
            row=row,
            message=message,
        )

    report_path = write_report(rows, output_dir, str(cfg.report.filename_prefix), run_id)
    succeeded = sum(1 for row in rows if row["status"] == "ok")
    summary = f"Analyzed {total} scan(s): {succeeded} succeeded, {total - succeeded} failed."
    print(f"\n{summary}")
    progress_message(
        progress,
        "complete",
        total=total,
        succeeded=succeeded,
        failed=total - succeeded,
        report_path=str(report_path),
        message=summary,
    )
    return report_path


@hydra.main(version_base=None, config_path="../config", config_name="config")
def main(cfg: DictConfig) -> None:
    report_path = run_analysis(cfg)
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
