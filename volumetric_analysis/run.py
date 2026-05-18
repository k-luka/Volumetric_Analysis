from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

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
        str(cfg.fastsurfer.python),
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


def run_fastsurfer(scan: Path, subject_id: str, subjects_dir: Path, cfg: DictConfig) -> int:
    command = build_fastsurfer_command(scan, subject_id, subjects_dir, cfg)
    env = os.environ.copy()
    if fastsurfer_executable(cfg) is None:
        home = Path(str(cfg.fastsurfer.home)).expanduser().resolve()
        env["FASTSURFER_HOME"] = str(home)
    return subprocess.run(command, env=env).returncode


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
    binary: bool,
) -> None:
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap

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
        if binary:
            overlay = np.ma.masked_where(labels[:, :, index] == 0, labels[:, :, index] > 0)
            cmap = ListedColormap(["#2ca7ff"])
        else:
            overlay = np.ma.masked_where(labels[:, :, index] == 0, labels[:, :, index])
            cmap = "tab20"
        axis.imshow(np.rot90(overlay), cmap=cmap, alpha=0.35, interpolation="nearest")
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
) -> None:
    shutil.copy2(segmentation_path, output_dir / str(cfg.qc.segmentation_name))
    if not conformed_image_path.exists():
        return

    save_example_qc(
        conformed_image_path,
        segmentation_path,
        output_dir / str(cfg.qc.color_image_name),
        int(cfg.qc.slices),
        binary=False,
    )
    save_example_qc(
        conformed_image_path,
        segmentation_path,
        output_dir / str(cfg.qc.binary_image_name),
        int(cfg.qc.slices),
        binary=True,
    )


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
) -> dict[str, object]:
    row = new_report_row(scan, subject_id)
    print(f"Processing {scan.name}")

    try:
        row["input_spacing_mm"] = spacing_text(read_spacing(scan))
    except Exception as exc:
        row["error"] = str(exc)
        return row

    return_code = run_fastsurfer(scan, subject_id, subjects_dir, cfg)
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
        save_example_outputs(conformed_image_path, segmentation_path, output_dir, cfg)

    return row


def write_report(
    rows: list[dict[str, object]],
    output_dir: Path,
    prefix: str,
    run_id: str,
) -> Path:
    reports_dir = output_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_path = reports_dir / f"{prefix}_{run_id}.xlsx"
    pd.DataFrame(rows, columns=REPORT_COLUMNS).to_excel(report_path, index=False)
    return report_path


@hydra.main(version_base=None, config_path="../config", config_name="config")
def main(cfg: DictConfig) -> None:
    input_dir = Path(str(cfg.input_dir)).expanduser().resolve()
    output_dir = Path(str(cfg.output_dir)).expanduser().resolve()
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    subjects_dir = output_dir / "runs" / run_id / "fastsurfer"
    output_dir.mkdir(parents=True, exist_ok=True)
    subjects_dir.mkdir(parents=True, exist_ok=True)

    scans = find_scans(input_dir, bool(cfg.recursive))
    print(f"Found {len(scans)} scan(s) in {input_dir}")
    if not scans:
        report_path = write_report([], output_dir, str(cfg.report.filename_prefix), run_id)
        print(f"Wrote report: {report_path}")
        return

    fastsurfer_home = ensure_fastsurfer(cfg)
    if fastsurfer_home is not None:
        cfg.fastsurfer.home = str(fastsurfer_home)

    subject_ids = unique_subject_ids(scans)
    rows: list[dict[str, object]] = []

    for scan in scans:
        subject_id = subject_ids[scan]
        rows.append(process_scan(scan, subject_id, subjects_dir, output_dir, cfg))

    report_path = write_report(rows, output_dir, str(cfg.report.filename_prefix), run_id)
    print(f"Wrote report: {report_path}")


if __name__ == "__main__":
    main()
