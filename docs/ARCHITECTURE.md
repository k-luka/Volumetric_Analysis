# Architecture

Last updated: 2026-06-06

This file is a table of contents for agents who need to understand the system quickly. It points to the files that matter, explains the current runtime shape, and avoids restating every implementation detail from the code.

## Read Order

1. `docs/STATE.md` - current app state, completed MVP work, verification commands, and environment notes.
2. `docs/NEXT_STEPS.md` - current execution queue.
3. `docs/CURRENT_SPEC.md` - scientific and product scope for the alpha workflow.
4. `docs/AGENT.md` - working constraints and user preferences for future coding agents.
5. This file - system map and ownership boundaries.

## Current Product Shape

The app is a local-first brain volume extraction tool. It wraps FastSurfer segmentation, reads `.nii` / `.nii.gz` MRI files from a local folder, writes results to a local output folder, and exposes the workflow through a React/FastAPI UI.

Streamlit is no longer the target UI. Keep it only as historical context unless the user explicitly asks to revisit it.

## Runtime Modes

| Mode | Entry Point | Purpose |
| --- | --- | --- |
| Local web UI | `./tools/launch_ui.sh` | Main MVP path. Builds React, starts FastAPI through the `vol-analysis` conda env, opens the browser. |
| FastAPI backend | `python -m volumetric_analysis.web --port 8765` | Backend-only local server. Serves API and production frontend when `frontend/dist` exists. |
| React dev server | `npm --prefix frontend run dev` | Frontend development against the API. |
| Wizard | `python -m volumetric_analysis` | Local terminal workflow. |
| Scripted CLI | `python -m volumetric_analysis.run input_dir=... output_dir=...` | Direct Hydra-configured batch execution. |
| HiPerGator/OOD | `deploy/ood/brain_volume_analysis/` | Planned batch deployment wrapper, not the active local MVP path. |

## Environment Boundary

Use the `vol-analysis` conda environment for live extraction. The repo `.venv` has reported Python 3.13 and is not suitable for FastSurfer extraction.

Important files:

- `requirements.txt` - Python dependencies used by the CLI/backend.
- `frontend/package.json` - React/Vite dependencies and frontend scripts.
- `config/config.yaml` - default Hydra runtime configuration.
- `external/fastsurfer/` - expected bundled/local FastSurfer location when present.

## Backend Map

| File | Responsibility |
| --- | --- |
| `volumetric_analysis/web.py` | FastAPI app, API models, report discovery/parsing, run registry, SSE events, static frontend serving, local folder picker endpoints, one-command launch CLI. |
| `volumetric_analysis/run.py` | Core analysis engine: scan discovery, FastSurfer invocation, volume calculation, Excel report writing, example segmentation/QC output. |
| `volumetric_analysis/check_env.py` | Runtime checks for Python/dependencies/FastSurfer readiness. |
| `volumetric_analysis/structures.py` | Structure-level volume summaries from segmentation labels. |
| `volumetric_analysis/report_pdf.py` | PDF report generation from Excel/report artifacts. |
| `volumetric_analysis/wizard.py` | Terminal wizard around the same analysis engine. |
| `volumetric_analysis/__main__.py` | Package entry point for the wizard. |

## API Surface

The frontend should use `frontend/src/lib/api.ts` rather than hardcoding fetch calls in components.

Main API groups:

| API | Purpose |
| --- | --- |
| `GET /api/defaults` | Startup defaults, device choices, saved report summaries. |
| `POST /api/scans/validate` | Validate input folder and readable NIfTI scans. |
| `POST /api/output/validate` | Validate output folder usability. |
| `POST /api/output/create` | Create the selected output folder. |
| `POST /api/paths/select-directory` | Open native local folder picker and return a server-readable path. |
| `POST /api/paths/select-files` | Open native local file picker and return server-readable scan paths. |
| `POST /api/runs` | Start a background analysis run. |
| `GET /api/runs/{run_id}` | Poll run state, logs, artifacts, and report id. |
| `POST /api/runs/{run_id}/cancel` | Cancel an in-progress run. |
| `GET /api/runs/{run_id}/events` | Server-sent event stream for run progress. |
| `GET /api/reports` | List saved and current-run reports. |
| `GET /api/reports/{identifier}` | Load report rows, metadata, structure volumes, and artifact URLs. |
| `GET /api/reports/{identifier}/download/xlsx` | Download Excel report. |
| `GET /api/reports/{identifier}/download/pdf` | Download generated PDF report when available. |
| `GET /api/reports/{identifier}/images/color` | Open the back-compat color QC montage. |
| `GET /api/reports/{identifier}/qc/{subject}` | Open the per-subject color QC montage. |
| `GET /api/reports/{identifier}/volume/{subject}/{kind}` | Serve the `.mgz` anat (`kind=anat`) or segmentation (`kind=seg`) volume for the 3D viewer. |
| `GET /api/atlas/regions` | Atlas region catalog used to label/color the segmentation overlay. |
| `GET /api/checks` | Runtime readiness checks. |

## Frontend Map

| File | Responsibility |
| --- | --- |
| `frontend/src/App.tsx` | App orchestration shell: wires the hooks below together, owns top-level layout and notice state. Run/report/folder/runtime/theme logic lives in `hooks/`, not inline. |
| `frontend/src/hooks/useRunStream.ts` | Run creation and SSE progress streaming (start run, parse events, track per-scan progress). |
| `frontend/src/hooks/useReports.ts` | Saved-report list loading and selection. |
| `frontend/src/hooks/useFolderSelection.ts` | Input/output folder selection state and validation. |
| `frontend/src/hooks/useRuntimeChecks.ts` | Runtime readiness checks (`GET /api/checks`). |
| `frontend/src/hooks/useAtlasCatalog.ts` | Atlas region catalog loading (`GET /api/atlas/regions`). |
| `frontend/src/hooks/useTheme.ts` | Persisted light/dark theme state. |
| `frontend/src/lib/api.ts` | Typed API wrapper and artifact/download helpers. |
| `frontend/src/lib/runProgress.ts` | Run-progress helpers: SSE event parsing, payload extraction, error/validation message formatting, idle/clamp utilities. |
| `frontend/src/lib/color.ts` | Color-space conversion helpers (hex↔HSV) for the region color picker. |
| `frontend/src/lib/regionColors.ts` | Default region color palette and per-index color assignment. |
| `frontend/src/types.ts` | Frontend API and UI state types. |
| `frontend/src/components/TopBar.tsx` | App top bar and persisted light/dark toggle. |
| `frontend/src/components/SetupPanel.tsx` | Input/output folder selection, recursive/device controls, runtime row, validate/run actions. |
| `frontend/src/components/ResultsCanvas.tsx` | Main results surface: progress bar, scan rows, metadata, structure/QC segmented detail view. Detail subviews live in `components/results/`. |
| `frontend/src/components/results/StructureTable.tsx` | Per-structure volume table for the selected scan. |
| `frontend/src/components/results/RegionPanel.tsx` | Region list with visibility/color controls for the overlay. |
| `frontend/src/components/results/ColorField.tsx` | App-themed color-picker popover (SV square + hue slider + hex input + opacity). |
| `frontend/src/components/results/QcViewer.tsx` | QC image/segmented detail view. |
| `frontend/src/components/results/RunProgressInline.tsx` | Inline run-progress display within the results surface. |
| `frontend/src/components/InspectorPanel.tsx` | Saved reports, artifact/download actions, runtime diagnostics, run logs/status. |
| `frontend/src/components/VolumeViewer.tsx` | Interactive 2D/3D segmentation viewer (NiiVue): renders MGZ anat + seg overlay with Montage/Slices/3D modes and per-plane slice sliders, backed by the `volume/{subject}/{kind}` and `atlas/regions` routes. |
| `frontend/src/lib/segLut.ts` | Builds the per-label color lookup table for the segmentation overlay. |
| `frontend/src/styles.css` | Photoshop-inspired shell tokens, panel layout, tables, controls, responsive behavior. |

## Data Flow

1. UI loads `GET /api/defaults`; results remain blank until the user loads a report or completes a run.
2. User selects or types an input scan folder and a results folder.
3. `Check folders` or `Run analysis` validates scans and output folder.
4. `Run analysis` checks runtime readiness, then creates a background run with `POST /api/runs`.
5. The frontend subscribes to `GET /api/runs/{runId}/events`.
6. Backend calls `run_analysis(...)` from `volumetric_analysis/run.py`.
7. `run_analysis` runs FastSurfer, computes volumes, and writes Excel plus QC artifacts under the chosen output folder.
8. Backend emits `report_written` and `complete`; frontend loads the report detail by id.
9. User inspects scan rows, structure volumes or QC images, and downloads artifacts.

## Output Layout

For a selected output folder:

| Path | Purpose |
| --- | --- |
| `reports/brain_volumes_*.xlsx` | Main per-run Excel report. |
| `runs/<run_id>/fastsurfer/<subject>/mri/...` | FastSurfer subject output and logs, keyed by run id/timestamp. |
| `example_segmentation.mgz` | Example segmentation used for structure/QC detail. |
| `qc/<subject>_color.png` | Per-subject color QC montage. |
| `example_qc_color.png` | Back-compat copy of the color QC montage. |

The PDF report is generated by the `/download/pdf` route when the segmentation artifact exists. It is served as a download response rather than treated as a required persisted output file.

## Testing And QC

Backend:

```bash
conda run -n vol-analysis python -m unittest tests/test_check_env.py tests/test_run.py tests/test_web.py tests/test_structures.py
```

Frontend:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Browser smoke:

1. Launch with `./tools/launch_ui.sh --port <free-port>`.
2. Confirm the initial Results area is blank.
3. Select input and output folders.
4. Validate folders.
5. Run a tutorial extraction when environment time allows.
6. Load the completed report.
7. Check Excel/PDF/QC actions and the structure/QC segmented view.
8. Check desktop and narrow viewport layout.

## Design Constraints

- Keep the local MVP simple and explicit.
- Do not reintroduce decorative controls that do not affect the workflow.
- Prefer typed API helpers and existing components over new abstractions.
- Preserve blank startup results; no fake/demo result should auto-load.
- Local path entry/selection is intentional. Browser upload is not the primary v1 flow.
- Treat FastSurfer as the segmentation method; this repo is a reproducible wrapper, not a new model.

## Related Docs

- `docs/CURRENT_SPEC.md` - alpha scope, method, outputs, and unresolved scientific/study questions.
- `docs/TECHNICAL_DEBT.md` - lower-priority engineering debt.
- `docs/OOD_BATCH_APP_PLAN.md` - HiPerGator Open OnDemand direction.
- `docs/SUBMIT_WIZARD_PLAN.md` - local wizard planning.
