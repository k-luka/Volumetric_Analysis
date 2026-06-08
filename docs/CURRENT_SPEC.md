# Current Alpha Spec

## Purpose

Batch process structural brain MRI scans, segment the brain, and write a whole-brain volume report for research review.

The alpha does not train a model. It wraps FastSurfer segmentation-only inference and computes volume from the output labels.

## Current Workflow

1. Read `.nii` and `.nii.gz` scans from an input folder.
2. Derive subject IDs from filenames.
3. Run FastSurfer segmentation-only inference.
4. Read `aparc.DKTatlas+aseg.deep.mgz`.
5. Count all nonzero segmentation voxels.
6. Multiply by segmentation voxel spacing.
7. Write a unique Excel report.
8. Save one example segmentation plus a per-subject color QC PNG.

## Model And Method

- Model family: FastSurferVINN / FastSurfer `asegdkt` segmentation.
- Output label map: FreeSurfer-style DKT/aparc + aseg labels.
- Alpha volume definition: all non-background labels merged into one volume.
- View aggregation: axial, coronal, and sagittal predictions are combined by weighted logits, then `argmax`.
- Current skipped modules: optional CerebNet and HypVINN are disabled with `--no_cereb --no_hypothal`.

Parameter counts from the downloaded FastSurfer checkpoints:

| Checkpoint | Parameters |
| --- | ---: |
| `aparc_vinn_axial_v2.0.0.pkl` | 1,860,692 |
| `aparc_vinn_coronal_v2.0.0.pkl` | 1,860,692 |
| `aparc_vinn_sagittal_v2.0.0.pkl` | 1,858,676 |
| Three-view total | 5,580,060 |

## Current Platform

- Python command-line tool.
- Local React/FastAPI browser UI for local workstation runs.
- Open OnDemand batch app wrapper for doctor-facing HiPerGator use.
- Conda env: `vol-analysis`.
- Python used locally: `3.10.20`.
- Config: Hydra YAML.
- Local test machine: Apple Silicon macOS.
- Intended batch machine: HiPerGator or another NVIDIA GPU Linux machine.
- Device selection: `fastsurfer.device=mps` for Mac Metal, `fastsurfer.device=cuda` for NVIDIA CUDA.
- Container/OOD path: Apptainer image launched as a Slurm batch job through HiPerGator Open OnDemand.
- Current primary demo path: production-built React frontend served by `python -m volumetric_analysis.web --port 8765` from the `vol-analysis` conda environment.

## Current Outputs

- `reports/brain_volumes_<timestamp>.xlsx`
- `example_segmentation.mgz`
- `example_qc_color.png`
- `runs/<timestamp>/fastsurfer/...`

Excel columns:

- `filename`
- `path`
- `subject_id`
- `input_spacing_mm`
- `segmentation_spacing_mm`
- `voxel_count`
- `volume_mm3`
- `volume_ml`
- `status`
- `error`

## Local Test Result

- FastSurfer branch: `stable`.
- Local FastSurfer tag: `v2.4.2`.
- Local FastSurfer commit: `7e53343`.
- Test input: FreeSurfer tutorial subject `140_orig`.
- Reported alpha volume: `1,246,351 mm3` / `1,246.351 mL`.

## Dependency License Notes

This is an engineering inventory, not legal advice.

| Component | Purpose | License |
| --- | --- | --- |
| FastSurfer | Segmentation pipeline and checkpoints | Apache-2.0 |
| PyTorch | Inference backend used by FastSurfer | BSD-3-Clause |
| Hydra | Config and CLI overrides | MIT |
| NiBabel | Read NIfTI/MGZ images | MIT |
| NumPy | Array math | Modified BSD |
| pandas | Report tables | BSD-3-Clause |
| openpyxl | Excel writer | MIT |
| Matplotlib | QC images | PSF/BSD-compatible |

## Meeting Assumptions And Questions

- Are the study scans all T1-weighted 3D MRIs?
- Will the doctor provide NIfTI files, DICOM folders, or both?
- Does "whole brain volume" mean all non-background FastSurfer labels, or should some labels be excluded?
- Should ventricles, CSF-like labels, cerebellum labels, brainstem, or other regions be included?
- Is direct voxel-count volume acceptable, or should the study report a FastSurfer/FreeSurfer stats-derived measure?
- How many scans should be visually QC'd: one example, all scans, or only failed/outlier scans?
- Which QC view is more useful for the doctor: multi-color anatomy, binary mask, or both?
- What subject identifiers should appear in the Excel file?
- What method/citation language does the professor want in the study materials?
- Where should real runs happen: HiPerGator, a lab workstation, or a controlled internal web app?
