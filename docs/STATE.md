# Project State

Last updated: 2026-06-06

## Current Direction

The local UI MVP is FastAPI plus React. Streamlit is no longer the target UI. The current visual reference is the Photoshop-inspired dark workbench shell, adapted to the actual analysis workflow rather than decorative Photoshop controls.

## Current Working App

- One-command local launch: `./tools/launch_ui.sh`
- Backend: activate `vol-analysis`, then `python -m volumetric_analysis.web --port 8765`
- Backend without shell activation: `conda run --no-capture-output -n vol-analysis python -m volumetric_analysis.web --port 8765`
- Frontend development: `npm --prefix frontend run dev`
- Production-style local UI: `python -m volumetric_analysis.web --build --open --port 8765`
- Primary workflow: pick scan files and a results folder with the native pickers, run analysis (folders and runtime are validated automatically), view real run results in the Structures/Slices/3D views, download Excel/PDF.
- Startup behavior: Results starts blank. Saved reports are available in the Reports panel but are not loaded until the user explicitly loads one.
- Full next-step queue: `docs/NEXT_STEPS.md`.

## MVP Progress

- Completed: interactive segmentation viewer and per-subject QC.
  - The frontend ships an interactive NiiVue 2D/3D viewer (`frontend/src/components/VolumeViewer.tsx` + `frontend/src/lib/segLut.ts`) that overlays FastSurfer labels on the MRI with Montage/Slices/3D modes and per-plane slice sliders.
  - The runner now writes a per-subject color QC montage at `qc/<subject>_color.png` (plus a back-compat `example_qc_color.png`); there is no binary/outline QC image.
  - New backend routes back the viewer: `GET /api/reports/{id}/qc/{subject}`, `GET /api/reports/{id}/volume/{subject}/{kind}` (`anat`/`seg` `.mgz`), and `GET /api/atlas/regions` (region catalog from `volumetric_analysis/structures.py`).
- Completed: React/FastAPI rebuild scaffold.
- Completed: Photoshop-style shell baseline.
- Completed: Removed fake/decorative controls from the first UI pass.
- Completed: MVP Step 1 app-flow reliability.
  - The backend now rejects empty, missing, or unreadable scan folders before creating a run.
  - The frontend no longer marks empty folders as ready.
  - Run events include `report_written`.
  - Completed runs can load reports written outside the repo `outputs/` folder while the run is still in memory.
  - Tests cover a mocked successful run through report loading and artifact availability.
- Completed: MVP Step 2 path validation and path-related UI feedback.
  - Added backend output-folder validation.
  - `Check scans` is now `Check folders` and validates both input scans and the output folder.
  - `Run analysis` requires both readable scans and usable output validation.
  - Tests cover unreadable scan files, existing output folders, creatable output folders, and output paths that are files.
  - Subagent review found and fixes were applied for output path normalization, complete-event error handling, and unreadable input directories.
- Completed: MVP Step 3 report loading robustness.
  - `/api/reports` now includes current-run reports created outside repo `outputs/` while the server is running.
  - Current-run-only reports are marked as temporary and shown with UI context.
  - Refresh preserves the active report when possible instead of silently switching to the newest report.
  - Deleted/missing known run reports return a clear `Report not found` error.
- Completed: MVP Step 4 downloads and QC artifact robustness.
  - Excel/PDF/QC actions are enabled only when the backing artifact route can work.
  - PDF is marked available only when the segmentation artifact exists.
  - Tests cover current-run report listing, missing PDF disablement, deleted report errors, and inspector artifact button states.
  - Subagent review found and fixes were applied for current-run detail metadata and active-report refresh behavior.
- Completed: pre-Step 5 UI usefulness cleanup.
  - Removed study metadata fields from the setup panel because they do not affect the local analysis run or current download workflow.
  - Removed the default brain parenchyma / segmented / ventricular metric cards from the main canvas.
  - Made scan-level report rows the primary result view.
  - Moved detailed structure volumes and QC images into advanced disclosure areas.
  - Removed the duplicate top-bar download button; report downloads now live in the inspector artifact area.
  - Applied review feedback: renamed setup/report controls for clearer purpose, demoted refresh and runtime diagnostics, made artifact buttons explicit download/open actions, and lazy-loads QC images only when the segmentation drawer is opened.
- Completed: MVP Step 5 progress bar foundation.
  - Added a persistent run progress meter in the Results header.
  - The progress fill uses the existing SSE run events and scan `index` / `total` payloads when available.
  - Added a blue gradient progress fill with subtle active shimmer.
  - Current step, percent, and current file or scan count now live between `Results` and the view state.
- Completed: progress/header refinement.
  - Moved the progress meter into the Results header between `Results` and the view state so it does not consume body space.
  - Replaced the advanced-structure sticky table header with a fixed header and separately scrollable body to avoid header bounce.
  - Made advanced-structure column headers visually distinct from the body rows.
- Completed: header text and theme cleanup.
  - Removed visible progress helper/state text so the Results header now shows only the gradient meter and percent.
  - Removed the redundant center-canvas view state label.
  - Added a top-right light/dark mode toggle with persisted local preference.
- Completed: local input folder selection.
  - Added a FastAPI endpoint that opens a native local directory picker and returns a server-readable folder path.
  - Added a select-folder icon button inside the Input folder control.
  - The text path remains editable as a fallback, but users no longer need to type the input path manually.
- Completed: end-to-end run usability guardrails.
  - Added the same select-folder affordance for the Results folder so users can choose both the input and output directories.
  - The web backend now passes the server Python executable through the FastSurfer config, matching the wizard launch path.
  - `Run analysis` now checks runtime readiness before creating a background run; failed runtime checks show a clear UI error and do not start extraction.
  - Added app-level frontend coverage for the validation-to-run flow when the runtime is not ready.
- Completed: real local UI extraction verification.
  - Installed the web dependencies into the existing `vol-analysis` conda environment.
  - Started the backend through `conda run --no-capture-output -n vol-analysis ...` so Python 3.10 is active and `python3.10` is on PATH for FastSurfer.
  - `/api/checks` passes for Python, dependencies, and FastSurfer, with only the expected Apple MPS fallback warning.
  - Ran the tutorial scan from the React UI: `data/tutorial` -> `outputs/ui_demo`.
  - New report: `outputs/ui_demo/reports/brain_volumes_20260604_111644.xlsx`.
  - Verified Excel, PDF, and color QC artifact routes return HTTP 200.
- Completed: macOS folder picker crash fix.
  - macOS directory selection now uses `osascript` first and never instantiates Tk from a FastAPI worker thread.
  - Tk remains only as a non-macOS fallback.
  - Added tests for AppleScript selection and cancel handling.
- Completed: direct Run analysis usability fix.
  - `Run analysis` is now enabled when both folder paths are filled unless a known validation error is showing.
  - Clicking `Run analysis` automatically validates input/output folders before runtime checks and extraction.
  - `Check folders` remains available as an optional preflight, not a required step.
  - Added frontend tests for direct run validation and validation failure handling.
- Completed: blank startup results state.
  - The app no longer auto-loads the newest saved report on startup.
  - The Results canvas starts with `No result loaded` until a run completes or the user explicitly loads a saved report.
  - Saved reports remain available in the Reports panel, but no report is selected by default.
  - Artifact actions stay disabled until a real active report is loaded.
- Completed: smoother and more truthful progress display.
  - The frontend now eases progress changes instead of jumping directly to each backend event value.
  - Long FastSurfer segmentation steps now advance with a capped time-based estimate until a real backend event confirms completion.
  - Real backend events remain authoritative; the UI does not show `100%` until complete/error.
  - Verified with frontend tests, production build, and one real tutorial run from the browser.
- Completed: failed-run recovery.
  - Failed analysis events now leave the UI usable and re-enable `Run analysis`.
  - The inspector shows a concise failed-state message instead of relying only on the progress meter.
  - Run logs are preserved in the inspector after failure, including backend logs fetched from the run status endpoint.
  - Duplicate consecutive log messages are collapsed on the frontend to keep the log readable.
  - Verified with frontend component/app tests and production build.
- Completed: runtime-ready indicator.
  - Added a compact runtime status row next to the run controls in the setup panel.
  - Runtime checks are cached after a manual check or run attempt and reused until the user explicitly rechecks.
  - `Run analysis` still validates runtime readiness before extraction and blocks on cached failures.
  - The inspector runtime diagnostics now share the same cached check results instead of running a separate local check.
  - Verified with frontend tests, production build, and a browser smoke test.
- Completed: output-folder convenience.
  - Added a backend endpoint to create the configured results folder, including missing parent folders when allowed.
  - Added a folder-plus action inside the Results folder field so users can create the output folder without leaving the app.
  - The UI updates output-folder validation immediately after creation and keeps `Run analysis` blocked if creation fails.
  - Verified with backend tests, frontend tests, production build, and a browser smoke test that created and cleaned up a temporary folder.
- Completed: report metadata display and center detail switch.
  - Report details now include operational metadata: modified time, report source, input folder, results folder, device, run state, and run id when known.
  - The Results canvas shows useful report context without reintroducing study metadata fields.
  - Advanced structure volumes and QC inspection are now mutually exclusive center views controlled by a segmented switch.
  - Structure rows are shown by default and QC images render only after switching to the QC view.
  - Verified with backend tests, frontend tests, production build, and a browser smoke test using a saved report.
- Completed: one-command launcher.
  - Added `python -m volumetric_analysis.web --build --open --port 8765`.
  - Added `tools/launch_ui.sh`, which runs the web server through the `vol-analysis` conda environment.
  - The backend now checks port availability before starting and prints a useful port-conflict message.
  - The server prints the local URL and can open the default browser after startup.
- Completed: agent architecture index.
  - Added `docs/ARCHITECTURE.md` as a quick system map for future coding agents.
  - Linked the architecture map from `docs/README.md`.
- Completed: 2026-06-06 desktop QC pass.
  - Frontend tests passed (`npm --prefix frontend test`).
  - Frontend production build passed.
  - Backend tests passed (`python -m unittest discover -s tests -p "test_*.py"`).
  - Launched the production app on `http://127.0.0.1:8777` through `./tools/launch_ui.sh --port 8777`.
  - Confirmed blank startup results before loading/running a report.
  - Created a fresh output folder through the UI: `outputs/qc_smoke_20260606_1229`.
  - Validated `data/tutorial` and the output folder through the UI.
  - Runtime check passed with only the expected Apple MPS fallback warning.
  - Ran the tutorial scan from the React UI.
  - New report: `outputs/qc_smoke_20260606_1229/reports/brain_volumes_20260606_122725.xlsx`.
  - Server logged 1 successful scan in 114 seconds, volume `1,246.4 mL`.
  - Verified report detail, Excel, PDF, and color QC routes returned HTTP 200.
  - Verified QC inspection renders the color montage and artifact buttons are marked ready.
  - Click-tested theme toggle, report refresh/load, recursive toggle, and compute-device menu.
  - Saved desktop screenshot: `outputs/qc_smoke_20260606_1229/ui_qc_desktop.png`.
- Completed: 2026-06-06 Chrome QC pass.
  - Connected to the Codex Chrome Extension in the user's Chrome profile.
  - Launched the production app on `http://127.0.0.1:8778` through `./tools/launch_ui.sh --port 8778`.
  - Confirmed blank startup results and no Chrome console errors.
  - Created a fresh output folder through the UI: `outputs/chrome_qc_20260606_1240`.
  - Validated `data/tutorial` and the output folder through the UI.
  - Runtime check passed with only the expected Apple MPS fallback warning.
  - Ran the tutorial scan from Chrome.
  - New report: `outputs/chrome_qc_20260606_1240/reports/brain_volumes_20260606_124002.xlsx`.
  - Server logged 1 successful scan in 88 seconds, volume `1,246.4 mL`.
  - Verified progress moved during segmentation and reached 100% after completion.
  - Verified loaded report metadata, scan row, structure table, and QC inspection view.
  - Verified Excel, PDF, and color QC routes returned HTTP 200.
  - Verified `Open color QC` opened an image tab in Chrome.
  - Click-tested theme toggle, report refresh/load, recursive toggle, and compute-device menu.
  - Restarted the server and confirmed startup was blank again.
  - After restart, loaded the saved report from the Reports panel and verified QC images still rendered.
  - Saved screenshots:
    - `outputs/chrome_qc_20260606_1240/ui_chrome_desktop.png`
    - `outputs/chrome_qc_20260606_1240/ui_chrome_post_restart_qc.png`
- Completed: README user guide.
  - Rewrote the root `README.md` as the practical local user guide.
  - Made `./tools/launch_ui.sh` the primary launch path.
  - Covered first-time setup, local launch, folder selection, output folder creation, running analysis, saved reports, downloads, QC views, output files, troubleshooting, and optional CLI paths.
  - Subagent review found one accepted usability issue: the guide needed to say commands are run from the repo root.
  - Subagent review also exposed a stale `docs/ARCHITECTURE.md` PDF output note; the architecture doc was corrected to describe PDF generation as an on-demand download route.
- Completed: final automated acceptance slice after README update.
  - Frontend tests passed (`npm --prefix frontend test`).
  - Frontend production build passed.
  - Backend tests passed (`python -m unittest discover -s tests -p "test_*.py"`).
  - Launched the production app on `http://127.0.0.1:8779` through `./tools/launch_ui.sh --port 8779`.
  - Confirmed blank startup results and no Chrome console warnings/errors.
  - Loaded saved report `outputs/chrome_qc_20260606_1240/reports/brain_volumes_20260606_124002.xlsx` from the Reports panel.
  - Verified scan row, structure table, and QC inspection image rendered.
  - Verified report detail, Excel, PDF, and color QC routes returned HTTP 200.
  - Saved screenshot: `outputs/final_acceptance_20260606/ui_final_fresh_launch_qc.png`.
- Completed: narrow viewport acceptance check.
  - Launched the production app on `http://127.0.0.1:8781`.
  - Used a fixed-width 390px iframe harness to render the app in a narrow viewport because the available Chrome automation surface cannot resize the real browser window.
  - Verified narrow startup controls were present: input folder, results folder, `Check folders`, `Run analysis`, progress bar, and blank results state.
  - Loaded saved report `outputs/chrome_qc_20260606_1240/reports/brain_volumes_20260606_124002.xlsx` inside the narrow viewport.
  - Verified saved-report controls, `Download Excel`, `Download PDF`, structure/QC segmented switch, and color QC rendered in the narrow viewport.
  - Chrome console logs had no warnings/errors during the narrow check.
  - Saved screenshots:
    - `outputs/final_acceptance_20260606/ui_narrow_same_origin_390.png`
    - `outputs/final_acceptance_20260606/ui_narrow_loaded_qc_390.png`
  - Harness artifact: `outputs/final_acceptance_20260606/narrow_harness.html`.
- Completed: 2026-06-10 browser QC pass with fixes (two rounds).
  - Drove a real tutorial run and a mid-segmentation cancel from Chrome using the `?dev` backdoor (`window.__bvDev`).
  - Fixed: the Run status card claimed `idle` during an active run; it now follows the SSE progress state and shows the selected device until the run reports the real one.
  - Fixed: a cancelled run left the progress bar frozen in the running blue; the freeze is now deliberate and styled amber via a `.cancelled` fill.
  - Fixed: the center canvas said `No result loaded - Run analysis...` while a first run was in flight; it now shows a spinner with the current step, file, and scan count.
  - Fixed: disabled primary buttons looked clickable in dark mode; they now desaturate explicitly.
  - Saved-results selector now shows human labels (`Jun 10, 2026, 8:20 PM · ui_demo`) with the folder/filename as the secondary line.
  - NiiVue is now lazy-loaded inside `VolumeViewer`; the main JS bundle dropped from 1,311 kB to 421 kB (464 kB to 133 kB gzip).
  - The idle progress rail fades until a run starts.
  - README/ARCHITECTURE/STATE were resynced to the file-picker + auto-validation + Structures/Slices/3D UI.

## Current QC Gaps

- Native folder picker buttons were not clicked during automation because they open OS-level dialogs. Backend picker route and macOS AppleScript/cancel tests passed, but the real OS dialog still needs a short manual macOS click check before final handoff.

## Current Verification Commands

```bash
npm --prefix frontend test
npm --prefix frontend run build
conda run -n vol-analysis python -m unittest discover -s tests -p "test_*.py"
```

## Known Environment Note

The repo `.venv` still reports Python 3.13 and should not be used for live extraction. Use the existing `vol-analysis` conda env for the backend. It reports Python 3.10.20 and passes FastSurfer checks when launched through `conda run` or an activated shell.

## Next Target

Remaining QC before final MVP handoff:

1. Manually click native input/results folder picker buttons on macOS.
