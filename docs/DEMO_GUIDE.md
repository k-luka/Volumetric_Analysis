# Demo Guide

Single source of truth for showing the alpha to a doctor / research stakeholder.
(Merged from the former `PRESENTATION_NEXT_STEPS.md` and `DOCTOR_DEMO_SCRIPT.md`.)

## Goal

Show a small, credible alpha through the local browser UI: one or more NIfTI
scans go in, FastSurfer segmentation runs, and segmentation/QC outputs plus an
Excel volume report come out.

## Before The Demo

1. Activate the Python 3.10 environment and run `python -m volumetric_analysis.check_env`.
2. Build and start the local UI:
   ```bash
   npm --prefix frontend run build
   conda run --no-capture-output -n vol-analysis python -m volumetric_analysis.web --port 8765
   ```
3. Confirm the UI defaults to `data/tutorial` and `outputs/ui_demo` when the tutorial scan is available.
4. Rerun the tutorial scan with the current config if there is enough time.
5. If allowed, run 1-3 representative de-identified study scans before the meeting.
6. Bring the Excel report plus both QC PNGs.
7. Bring `docs/CURRENT_SPEC.md` and this guide as meeting notes.
8. Prepare a short methods paragraph that cites FastSurfer/FastSurferVINN.

## Click Path

1. Open `http://127.0.0.1:8765`.
2. Confirm the Results area starts blank.
3. Keep `data/tutorial` as the input folder for the controlled demo, or select a folder with the folder icon.
4. Keep `outputs/ui_demo` as the output folder, or select a results folder with the folder icon.
5. Keep **Compute device** on `auto` unless you need to force `cpu`, `mps`, or `cuda`.
6. Click **Run analysis** if there is enough meeting time. `Check folders` is optional preflight.
7. Review the Excel row and the color/binary QC images in the UI after completion.
8. If the live run is too slow, manually load a saved report from the Reports panel.

## Demo Packet

- One input filename.
- One Excel output row.
- One multi-color QC image.
- One binary QC image.
- Local UI showing the report and QC images.
- Current assumptions and questions for the doctor.
- Current limitations: alpha workflow, NIfTI-only input, one example QC output, no clinical interpretation yet.

## Say Clearly

- This is an alpha research workflow, not a clinical diagnostic product.
- The segmentation model is FastSurfer/FastSurferVINN; this project wraps it and computes a whole-brain alpha volume.
- Current input is NIfTI only (`.nii` / `.nii.gz`).
- Current volume definition is all non-background FastSurfer labels.
- Current QC output is one example montage per run, not a full per-subject QC review system.
- HiPerGator/Open OnDemand is scaffolded but not doctor-ready until a real Slurm + Apptainer submission succeeds on the cluster.

## Do Not Claim Yet

- Do not claim study readiness until the volume definition and QC expectations are confirmed.
- Do not present the segmentation model as original work.
- Do not ask doctors to install or run the command-line workflow directly.
