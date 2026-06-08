"""Interactive local wizard for brain volume analysis.

Run it with one command:

    python -m volumetric_analysis

It asks where the scans are, checks that they exist and are readable, asks where
to put the results, then runs the analysis on this computer. The compute device
is auto-detected (Apple Silicon -> mps, otherwise cpu); override it with
--device cpu|mps|cuda. Pass --dry-run to answer the questions and print the
resolved configuration without running.
"""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path

from hydra import compose, initialize_config_dir
from omegaconf import OmegaConf

from volumetric_analysis.run import display_path, find_scans, read_spacing, run_analysis

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent
CONFIG_DIR = REPO_ROOT / "config"
BUNDLED_FASTSURFER = REPO_ROOT / "external" / "fastsurfer" / "run_fastsurfer.sh"


def _input(prompt_text: str) -> str:
    """input() that exits cleanly on Ctrl-D / end of piped input."""
    try:
        return input(prompt_text)
    except EOFError:
        raise SystemExit("\nNo more input - exiting.")


def ask_yes_no(question: str, default: bool = False) -> bool:
    hint = "Y/n" if default else "y/N"
    while True:
        reply = _input(f"{question} [{hint}]: ").strip().lower()
        if not reply:
            return default
        if reply in {"y", "yes"}:
            return True
        if reply in {"n", "no"}:
            return False
        print("Please answer y or n.")


def default_device() -> str:
    """Pick a sensible compute device. Apple Silicon -> mps, otherwise cpu."""
    if platform.system() == "Darwin" and platform.machine() in {"arm64", "aarch64"}:
        return "mps"
    return "cpu"


def resolve_device() -> str:
    """Auto-detect the compute device, allowing an override via --device VALUE."""
    args = sys.argv[1:]
    for index, arg in enumerate(args):
        if arg == "--device" and index + 1 < len(args):
            return args[index + 1].strip().lower()
        if arg.startswith("--device="):
            return arg.split("=", 1)[1].strip().lower()
    return default_device()


def validate_scans(input_dir: Path, recursive: bool):
    """Return (all scans, readable scans, [(scan, problem)]) for the folder."""
    scans = find_scans(input_dir, recursive)
    readable: list[Path] = []
    problems: list[tuple[Path, str]] = []
    for scan in scans:
        try:
            read_spacing(scan)
            readable.append(scan)
        except Exception as exc:  # noqa: BLE001 - report any read failure to the user
            problems.append((scan, str(exc)))
    return scans, readable, problems


def ask_input_folder() -> tuple[Path, bool]:
    """Prompt for the scan folder and confirm it holds readable scans."""
    while True:
        raw = _input("Folder containing your MRI scans (.nii / .nii.gz): ").strip()
        if not raw:
            print("Please enter a folder path.")
            continue
        folder = Path(raw).expanduser()
        if not folder.is_dir():
            print(f"That folder was not found: {folder}")
            continue
        folder = folder.resolve()

        recursive = ask_yes_no("Search subfolders too?", default=False)
        scans, readable, problems = validate_scans(folder, recursive)

        if not scans:
            print(f"No .nii or .nii.gz files were found in {folder}.")
            if ask_yes_no("Try a different folder?", default=True):
                continue
            raise SystemExit("Nothing to process - exiting.")

        print(f"Found {len(scans)} scan file(s); {len(readable)} look readable.")
        for scan, message in problems:
            print(f"  ! {scan.name}: {message}")
        if problems and not ask_yes_no("Some files had problems. Continue anyway?", default=True):
            continue
        return folder, recursive


def build_config(input_dir: Path, output_dir: Path, recursive: bool, device: str):
    """Compose the Hydra config and apply the wizard's answers."""
    with initialize_config_dir(version_base=None, config_dir=str(CONFIG_DIR)):
        cfg = compose(config_name="config")
    cfg.input_dir = str(input_dir)
    cfg.output_dir = str(output_dir)
    cfg.recursive = recursive
    cfg.quiet = True  # send FastSurfer's verbose output to a log file, not the console
    cfg.fastsurfer.device = device
    cfg.fastsurfer.python = sys.executable
    # Use the FastSurfer bundled in the repo if present, so this works from any
    # working directory instead of relying on the relative config default.
    if BUNDLED_FASTSURFER.exists():
        cfg.fastsurfer.home = str(BUNDLED_FASTSURFER.parent)
    return cfg


def main() -> None:
    print("=" * 44)
    print(" Brain Volume Analysis - local run")
    print("=" * 44)
    print()
    print("This runs the analysis on THIS computer. Answer a few questions.")
    print()

    dry_run = "--dry-run" in sys.argv

    input_dir, recursive = ask_input_folder()

    default_out = Path.cwd() / "volumetric_output"
    raw_out = _input(f"Folder for the results [{display_path(default_out)}]: ").strip()
    output_dir = (Path(raw_out).expanduser() if raw_out else default_out).resolve()

    device = resolve_device()

    print()
    print("Please review:")
    print(f"  Scans in:    {display_path(input_dir)}")
    print(f"  Results to:  {display_path(output_dir)}")
    print(f"  Subfolders:  {'yes' if recursive else 'no'}")
    print(f"  Device:      {device}")
    print()
    if not ask_yes_no("Run the analysis now?", default=True):
        raise SystemExit("Cancelled - nothing was run.")

    if device == "mps":
        # FastSurfer needs this to fall back to CPU for unsupported MPS ops.
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    cfg = build_config(input_dir, output_dir, recursive, device)

    if dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        print("[dry-run] Resolved configuration:")
        print(OmegaConf.to_yaml(cfg))
        print("[dry-run] Not running the analysis.")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    print()
    print(f"Detailed logs are saved under {display_path(output_dir)}.")
    print("This can take a minute or two per scan.")
    report_path = run_analysis(cfg)
    print()
    print("Done.")
    print(f"  Report:   {display_path(report_path)}")
    print(f"  Outputs:  {display_path(output_dir)}")


if __name__ == "__main__":
    main()
