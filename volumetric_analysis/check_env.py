from __future__ import annotations

import importlib.util
import os
import platform
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REQUIRED_IMPORTS = [
    ("hydra", "hydra-core"),
    ("nibabel", "nibabel"),
    ("numpy", "numpy"),
    ("pandas", "pandas"),
    ("openpyxl", "openpyxl"),
    ("matplotlib", "matplotlib"),
    ("fastapi", "fastapi"),
    ("uvicorn", "uvicorn"),
]


@dataclass
class Check:
    label: str
    status: str
    detail: str


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def fastsurfer_runner() -> Path:
    home = os.environ.get("FASTSURFER_HOME")
    if home:
        return Path(home).expanduser() / "run_fastsurfer.sh"
    return repo_root() / "external" / "fastsurfer" / "run_fastsurfer.sh"


def import_check(module: str, package: str) -> Check:
    if importlib.util.find_spec(module) is not None:
        return Check(package, "ok", f"import {module}")
    return Check(package, "fail", f"missing import {module}; run python -m pip install -r requirements.txt")


def python_check() -> Check:
    version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if sys.version_info[:2] == (3, 10):
        return Check("Python", "ok", f"{version} at {sys.executable}")
    return Check("Python", "fail", f"{version} at {sys.executable}; expected Python 3.10")


def mps_check() -> Check | None:
    if platform.system() != "Darwin" or platform.machine() not in {"arm64", "aarch64"}:
        return None
    if os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1":
        return Check("Apple MPS fallback", "ok", "PYTORCH_ENABLE_MPS_FALLBACK=1")
    return Check(
        "Apple MPS fallback",
        "warn",
        "set PYTORCH_ENABLE_MPS_FALLBACK=1 before MPS runs; the UI and wizard set it automatically",
    )


def fastsurfer_check() -> Check:
    runner = fastsurfer_runner()
    if not runner.exists():
        return Check(
            "FastSurfer",
            "fail",
            f"run_fastsurfer.sh not found at {runner}; set FASTSURFER_HOME or install external/fastsurfer",
        )
    if not os.access(runner, os.X_OK):
        return Check("FastSurfer", "warn", f"found but not executable: {runner}")

    try:
        result = subprocess.run(
            [str(runner), "--version"],
            cwd=str(repo_root()),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return Check("FastSurfer", "warn", f"found at {runner}, but --version timed out")
    except OSError as exc:
        return Check("FastSurfer", "fail", f"found at {runner}, but could not run it: {exc}")

    output = " ".join(line.strip() for line in result.stdout.splitlines() if line.strip())
    if result.returncode == 0:
        return Check("FastSurfer", "ok", output or str(runner))
    return Check("FastSurfer", "fail", output or f"--version failed with exit code {result.returncode}")


def run_checks() -> list[Check]:
    checks = [python_check()]
    checks.extend(import_check(module, package) for module, package in REQUIRED_IMPORTS)
    checks.append(fastsurfer_check())
    mps = mps_check()
    if mps is not None:
        checks.append(mps)
    return checks


def main() -> None:
    checks = run_checks()
    for check in checks:
        print(f"[{check.status.upper()}] {check.label}: {check.detail}")

    failures = [check for check in checks if check.status == "fail"]
    if failures:
        print()
        print("Environment is not ready for a live local demo.")
        raise SystemExit(1)

    print()
    print("Environment is ready for the local web app.")


if __name__ == "__main__":
    main()
