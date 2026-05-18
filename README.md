# Volumetric Analysis Alpha

Minimal batch tool for whole-brain volume extraction from `.nii` and `.nii.gz` MRI scans.

## Setup

```bash
conda create -n vol-analysis python=3.10
conda activate vol-analysis
python -m pip install -r requirements.txt
```

By default, the runner expects FastSurfer at `FASTSURFER_HOME` or `external/fastsurfer`.
If FastSurfer is missing, the default config will clone the stable branch and install its
Python requirements.

On Apple Silicon macOS, use FastSurfer's macOS requirements file:

```bash
python -m volumetric_analysis.run \
  input_dir=/path/to/scans \
  output_dir=/path/to/outputs \
  fastsurfer.requirements_file=requirements.mac.txt \
  fastsurfer.device=mps
```

Before using MPS on Apple Silicon, set:

```bash
export PYTORCH_ENABLE_MPS_FALLBACK=1
```

## Run

```bash
python -m volumetric_analysis.run input_dir=/path/to/scans output_dir=/path/to/outputs
```

Common overrides:

```bash
python -m volumetric_analysis.run \
  input_dir=/path/to/scans \
  output_dir=/path/to/outputs \
  fastsurfer.home=/path/to/FastSurfer \
  fastsurfer.install_if_missing=false
```

Outputs:

- Unique Excel report in `outputs/reports/`.
- One overwritten example segmentation at `outputs/example_segmentation.mgz`.
- One overwritten multi-color QC montage at `outputs/example_qc_color.png`.
- One overwritten binary QC montage at `outputs/example_qc_binary.png`.
- FastSurfer run files under `outputs/runs/`.

## HiPerGator Open OnDemand

The doctor-facing path is an Open OnDemand batch app. The user enters an input folder, output folder, optional email, and Slurm resources. OOD submits a GPU job that runs the Apptainer container and writes outputs to the selected folder.

Build the Apptainer image from `deploy/apptainer/`, then install the OOD batch app from `deploy/ood/brain_volume_analysis/`. See `docs/OOD_BATCH_APP_PLAN.md` for the current deployment plan.
