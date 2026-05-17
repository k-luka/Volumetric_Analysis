# Volumetric Analysis Alpha

Minimal batch tool for whole-brain volume extraction from `.nii` and `.nii.gz` MRI scans.

## Setup

```bash
python3 -m pip install -r requirements.txt
```

By default, the runner expects FastSurfer at `FASTSURFER_HOME` or `external/fastsurfer`.
If FastSurfer is missing, the default config will clone the stable branch and install its
Python requirements.

## Run

```bash
python3 -m volumetric_analysis.run input_dir=/path/to/scans output_dir=/path/to/outputs
```

Common overrides:

```bash
python3 -m volumetric_analysis.run \
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
