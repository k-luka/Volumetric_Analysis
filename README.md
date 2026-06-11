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
2. Click **Choose scans…** and pick one or more `.nii` / `.nii.gz` files in the file dialog.
3. Click **Choose results folder…** and pick the folder where outputs should be written (or keep the default).
4. Keep **Compute device** on `Automatic` unless you specifically need `cpu`, `mps`, or `cuda`.
5. Click **Run analysis**.

The app validates the selected scans and results folder automatically once both are set — the **System status** row under the run button shows the result, and you can expand it for details or click the stethoscope button to recheck the runtime. `Run analysis` re-runs the folder and runtime checks before extraction, so no manual preflight is required.

During a run, the progress bar in the Results header updates while FastSurfer is segmenting, and a **Stop** button appears next to **Run analysis** if you need to cancel. Segmentation can take minutes depending on device and scan size.

## Try The Tutorial Scan

If the tutorial data exists, choose this scan with **Choose scans…**:

```text
data/tutorial/140_orig.nii.gz
```

The results folder defaults to `outputs/ui_demo`. The tutorial scan is useful for confirming the app works end to end before using study data.

## View Results

After a run completes, the app loads the report automatically.

The center Results area shows:

- subject and report metadata
- a **Structures** view with detailed per-structure volumes
- **Slices** and **3D** views: an interactive segmentation viewer (built on
  NiiVue) that overlays the FastSurfer labels on the MRI, with per-plane slice
  sliders and a **Regions** menu for per-region colors and opacity

The right Reports panel shows:

- the saved-results selector
- **Download Excel** and **Download PDF** (enabled once the artifacts exist)
- run status, per-scan volume rows, the run log, and the system check

Saved reports are listed in the Reports panel, but the app starts blank. A report loads only after a run completes or after you select one from the saved-results list.

## Output Files

For each selected results folder, the app writes:

```text
reports/brain_volumes_*.xlsx
runs/<run_id>/fastsurfer/<subject>/mri/...
example_segmentation.mgz
example_qc_color.png
qc/<subject>_color.png
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

**File or folder picker fails**

The pickers use the native macOS dialog (AppleScript) with a Tk fallback on other platforms. If a dialog does not appear, check the server terminal for errors and confirm the backend is running through the `vol-analysis` environment.

**No results appear on startup**

This is intentional. Use **Run analysis** or pick a saved report from the **Result** list in the Reports panel — selecting it loads it.

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

## Development

Backend tests (run through the `vol-analysis` conda environment):

```bash
python -m unittest discover -s tests -p "test_*.py"
```

Frontend tests (Vitest):

```bash
npm --prefix frontend test
```

Frontend dev server (Vite, runs against the FastAPI backend):

```bash
npm --prefix frontend run dev
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
