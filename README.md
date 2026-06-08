# Volumetric Analysis Alpha

Local brain volume extraction for `.nii` and `.nii.gz` MRI scans.

The main workflow is the local web UI. It runs on your computer, reads scan folders from your filesystem, writes results to a local output folder, and uses FastSurfer for segmentation.

## What You Need

- Conda
- Python 3.10 in a conda environment named `vol-analysis`
- Node.js/npm for building the React UI
- FastSurfer available through the project config, `FASTSURFER_HOME`, or `external/fastsurfer`

Do not use the repo `.venv` for live extraction. It has reported Python 3.13, which can load parts of the app but is not the supported FastSurfer runtime. Use `vol-analysis`.

## First-Time Setup

Open a terminal at the repository root before running commands:

```bash
cd /path/to/Volumetric_Analysis
```

Create and activate the Python environment:

```bash
conda create -n vol-analysis python=3.10
conda activate vol-analysis
python -m pip install -r requirements.txt
```

Install frontend packages:

```bash
npm --prefix frontend install
```

Check the runtime:

```bash
python -m volumetric_analysis.check_env
```

On Apple Silicon macOS, an MPS fallback warning is expected. The local UI and wizard set `PYTORCH_ENABLE_MPS_FALLBACK=1` automatically for MPS runs.

## Launch The Local UI

Use the launcher:

```bash
./tools/launch_ui.sh
```

This builds the React frontend, starts the FastAPI backend through the `vol-analysis` conda environment, and opens:

```text
http://127.0.0.1:8765
```

If port `8765` is busy, choose another port:

```bash
./tools/launch_ui.sh --port 8766
```

If you already activated `vol-analysis` and do not want to use the wrapper:

```bash
python -m volumetric_analysis.web --build --open --port 8765
```

Stop the server with `Ctrl-C` in the terminal where it is running.

## Run An Analysis

1. Open the local UI.
2. Choose an **Input folder** containing `.nii` or `.nii.gz` scans.
3. Choose a **Results folder** where outputs should be written.
4. Use the folder-plus button if you want the app to create the results folder.
5. Keep **Compute device** on `auto` unless you specifically need `cpu`, `mps`, or `cuda`.
6. Turn on **Search subfolders** only if scans are nested inside the input folder.
7. Click **Check folders** if you want a preflight check.
8. Click **Run analysis**.

`Run analysis` also performs the required folder and runtime checks before extraction. `Check folders` is optional.

During a run, the progress bar updates while FastSurfer is segmenting. Segmentation can take minutes depending on device and scan size.

## Try The Tutorial Scan

If the tutorial data exists, the app defaults to:

```text
Input folder: data/tutorial
Results folder: outputs/ui_demo
```

The tutorial scan is useful for confirming the app works end to end before using study data.

## View Results

After a run completes, the app loads the report automatically.

The center Results area shows:

- subject and report metadata
- scan-level volume rows
- a **Structures** view with detailed structure volumes
- a **QC inspection** view with color and outline QC images

The right Reports panel shows saved reports and artifact actions:

- **Download Excel**
- **Download PDF**
- **Open color QC**
- **Open outline QC**

Saved reports are listed in the Reports panel, but the app starts blank. A report loads only after a run completes or after you explicitly load one from the Reports panel.

## Output Files

For each selected results folder, the app writes:

```text
reports/brain_volumes_*.xlsx
runs/<subject>/
example_segmentation.mgz
example_qc_color.png
example_qc_binary.png
```

The Excel file is the primary analysis output. The PDF is generated when you click **Download PDF** and the segmentation artifact exists. The QC images are supporting review artifacts.

## Troubleshooting

**Port is already in use**

Open the existing URL or start on a different port:

```bash
./tools/launch_ui.sh --port 8766
```

**The app launches, but extraction fails**

Confirm the backend is running through `vol-analysis`:

```bash
conda run --no-capture-output -n vol-analysis python -m volumetric_analysis.check_env
```

Do not launch live extraction from the repo `.venv`.

**FastSurfer is not ready**

Run the environment check and review the FastSurfer path:

```bash
conda activate vol-analysis
python -m volumetric_analysis.check_env
```

The default config expects FastSurfer from `FASTSURFER_HOME`, `external/fastsurfer`, or an explicit executable path in config.

**Folder picker fails or is inconvenient**

The path fields remain editable. You can paste or type a local path directly.

**No results appear on startup**

This is intentional. Use **Run analysis** or select a saved report in the Reports panel and click **Load result**.

**Run takes a long time**

FastSurfer segmentation is the slow step. Leave the server terminal open and watch the progress bar or Run log.

## Optional CLI Paths

Interactive terminal wizard:

```bash
conda activate vol-analysis
python -m volumetric_analysis
```

Scripted batch run:

```bash
conda activate vol-analysis
python -m volumetric_analysis.run input_dir=/path/to/scans output_dir=/path/to/results
```

Common scripted override:

```bash
python -m volumetric_analysis.run \
  input_dir=/path/to/scans \
  output_dir=/path/to/results \
  fastsurfer.home=/path/to/FastSurfer \
  fastsurfer.install_if_missing=false
```

## Project Docs

The project docs live in `docs/`.

Start here for development context:

- `docs/README.md`
- `docs/STATE.md`
- `docs/NEXT_STEPS.md`
- `docs/ARCHITECTURE.md`
- `docs/AGENT.md`

Deployment and future planning notes are also under `docs/` and `deploy/`.
