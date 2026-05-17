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
  fastsurfer.extra_args='["--device","mps"]'
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
- One overwritten QC montage at `outputs/example_qc.png`.
- FastSurfer run files under `outputs/runs/`.
