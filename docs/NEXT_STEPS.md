# Next Steps

Last updated: 2026-06-10

These are the next valid tasks for the local React/FastAPI MVP, in practical execution order.

For the history of completed work, see the changelog in `docs/STATE.md`.

## 1. Remaining Final MVP Acceptance

Planned work:

- Manually click native input/results folder picker buttons on macOS.
  - Backend picker route and macOS AppleScript/cancel tests already pass.
  - Remaining verification is the real OS dialog interaction: click picker, choose a folder, confirm the UI path populates, and confirm no crash or `failed to fetch`.

## 2. Review mode polish (core shipped 2026-06-10)

Review mode exists: "Open results folder…" in the Reports panel registers an
existing results folder (e.g. HPC output) via `POST /api/reports/open-folder`
and renders report/QC/viewer without running anything (see `docs/STATE.md`).
Remaining polish ideas:

- Persist opened review folders across app restarts (currently in-memory).
- A CPU-only OOD interactive app that launches this UI on HiPerGator so
  results never need downloading.

## 3. Rebuild the container image for B200 / sm_100 GPUs (optional, when needed)

The current image's PyTorch (FastSurfer cuda-v2.4.2 base) supports sm_50–sm_90
only. L4 and A100 work; B200 (sm_100) fails with "no kernel image is available".
A validated `PYTHONPATH` shadow workaround (torch 2.7.1+cu128 on `/blue`) is
documented in `docs/STATE.md`; the clean fix is rebuilding the image with a
cu128/sm_100-capable torch + torchvision.
