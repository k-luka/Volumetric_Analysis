# Agent Context

## Project

This repo is for a minimal alpha brain volume extraction tool for a University of Florida research workflow. The user is acting as the consultant. The tool itself should stay simple: batch segment MRI scans and report whole-brain volumes.

The starting point was `Tutorial_FastSurferCNN_QuickSeg.ipynb`, a Colab-style FastSurfer tutorial. It uses FastSurfer's segmentation-only path and VINN checkpoints to create `aparc.DKTatlas+aseg.deep.mgz` segmentations.

## Current Alpha Goal

Build a Python command-line tool that:

- Accepts `.nii` and `.nii.gz` scans.
- Assumes mostly T1-weighted 3D MRI inputs.
- Runs FastSurferVINN segmentation.
- Computes alpha whole-brain volume as all non-background segmentation labels.
- Writes a unique Excel report per run.
- Saves one example segmentation and two QC slice montages for visual inspection.
- Uses filename-based subject IDs.
- Skips scans with missing or invalid voxel spacing and reports the error in Excel.
- Is configurable through Hydra YAML.
- Can run on HiPerGator, an NVIDIA GPU machine, or a powerful local machine.

Expected alpha batch size is about 50 volumes.

## Important Design Constraints

- Keep the alpha minimal. Do not add broad exception handling, a GUI, Docker, DICOM support, database storage, model comparisons, or extra reporting unless the user explicitly asks.
- Prefer clear, direct code over abstraction.
- Preserve the user's requirement that the tool be usable for consulting work. Check licenses before adding dependencies.
- For study readiness, record exact tool versions, model/checkpoint choices, voxel spacing, command options, and output definitions.
- Do not present the tool as a new segmentation model. It is a reproducible wrapper around a cited segmentation method.

## Current Implementation

- Main runner: `volumetric_analysis/run.py`
- Config: `config/config.yaml`
- Python dependencies: `requirements.txt`
- Scope notes and remaining study questions: `OPEN_QUESTIONS.md`
- Current alpha spec: `docs/CURRENT_SPEC.md`
- Presentation next steps: `docs/PRESENTATION_NEXT_STEPS.md`
- Technical debt tracker: `docs/TECHNICAL_DEBT.md`
- Open OnDemand batch app plan: `docs/OOD_BATCH_APP_PLAN.md`
- Usage instructions: `README.md`
- Apptainer container files: `deploy/apptainer/`
- Open OnDemand batch app wrapper: `deploy/ood/brain_volume_analysis/`

The runner:

1. Finds `.nii` and `.nii.gz` files.
2. Optionally clones FastSurfer if missing.
3. Calls `run_fastsurfer.sh --seg_only`.
4. Reads `aparc.DKTatlas+aseg.deep.mgz`.
5. Counts nonzero voxels.
6. Multiplies by segmentation voxel spacing.
7. Writes an Excel report.
8. Copies one example segmentation and writes one color QC PNG plus one binary QC PNG.

## License Notes

- FastSurfer is Apache-2.0.
- Hydra is MIT licensed.
- Prefer FastSurfer segmentation-only for alpha.
- Avoid depending on the full FreeSurfer `recon-all` pipeline unless the user explicitly asks, because FreeSurfer has separate license terms and heavier workflow requirements.

## Environment Notes

- Use Conda as the primary environment path, but do not use an `environment.yml` unless the user explicitly asks.
- Recommended environment name: `vol-analysis`.
- Create the environment with Python 3.10, then install `requirements.txt` into it with pip.
- On Apple Silicon macOS, FastSurfer should use `requirements.mac.txt` and can try `fastsurfer.device=mps` with `PYTORCH_ENABLE_MPS_FALLBACK=1`.
- In the Apptainer container, use `fastsurfer.executable=/fastsurfer/run_fastsurfer.sh` and `fastsurfer.device=cuda`.
- The doctor-facing HiPerGator workflow is an OOD batch form that submits a Slurm job. Do not reintroduce an interactive GPU web session unless the user explicitly asks.

## Open Scientific Questions

- Confirm whether all study scans are T1-weighted 3D MRIs.
- Confirm the desired scientific definition of "whole brain volume."
- Decide whether a future version should support DICOM input directly.
- Decide how voxel spacing problems should be corrected in future versions.
- Confirm the exact FastSurfer version/checkpoints to pin for study reproducibility.
- Confirm citation language required by the professor or study protocol.

## User Preference

The user specifically warned that AI agents often overbuild. Keep changes small, explicit, and focused on the requested functionality.

Ralph may exist locally as an experimental agentic loop tool. `.ralph/` is ignored; only use Ralph when the user asks for it on a concrete feature.
