# Next Steps

Last updated: 2026-06-06

These are the next valid tasks for the local React/FastAPI MVP, in practical execution order.

## Completed Recently

- Smooth and truthful progress display.
  - Progress changes now ease toward backend event targets instead of jumping.
  - Long segmentation steps advance with a capped time-based estimate.
  - Real backend events remain authoritative; completion still requires a backend complete/error event.
  - Verified with frontend tests, production build, and one real tutorial run.
- Failed-run recovery.
  - Failed analysis events now leave the UI usable and preserve useful logs.
  - The inspector shows a concise failed-state message and an expandable run log.
  - `Run analysis` is usable again after a failed run.
  - Verified with frontend component/app tests and production build.
- Runtime-ready indicator.
  - A compact runtime status row now appears next to the run controls.
  - Runtime checks are cached until explicit recheck.
  - `Run analysis` reuses cached runtime status and still blocks on failures.
  - The inspector runtime diagnostics share the same cached check results.
  - Verified with frontend tests, production build, and browser smoke test.
- Output-folder convenience.
  - The backend can create the configured results folder, including missing parents when permissions allow.
  - The setup panel has a folder-plus action in the Results folder field.
  - Output validation updates immediately after folder creation.
  - Verified with backend tests, frontend tests, production build, and browser smoke test.
- Report metadata display and center detail switch.
  - Report detail responses include operational metadata for source, paths, timestamp, device, and run state when known.
  - The Results canvas displays the metadata without adding study fields back.
  - Structure volumes and QC inspection are mutually exclusive center views.
  - Verified with backend tests, frontend tests, production build, and browser smoke test.
- One-command launcher.
  - `python -m volumetric_analysis.web --build --open --port 8765` builds the frontend, starts the server, and opens the browser.
  - `tools/launch_ui.sh` runs that command through the `vol-analysis` conda environment.
  - Port conflicts are detected before Uvicorn starts.
- Agent architecture index.
  - `docs/ARCHITECTURE.md` now gives future agents a quick system map, runtime table, file map, API map, data flow, output layout, and QC command list.
  - `docs/README.md` links to the architecture map.
- Desktop QC pass on 2026-06-06.
  - Backend tests passed.
  - Frontend tests passed.
  - Production build passed.
  - Production UI launched through `./tools/launch_ui.sh --port 8777`.
  - Blank startup was confirmed.
  - Output folder creation, folder validation, runtime check, and tutorial run were executed from the UI.
  - Tutorial report produced: `outputs/qc_smoke_20260606_1229/reports/brain_volumes_20260606_122725.xlsx`.
  - Report detail, Excel, PDF, color QC, and binary QC routes returned HTTP 200.
  - QC inspection view rendered both images.
  - Theme toggle, report refresh/load, recursive toggle, and compute-device menu were click-tested.
- Chrome QC pass on 2026-06-06.
  - Connected through the Codex Chrome Extension.
  - Production UI launched through `./tools/launch_ui.sh --port 8778`.
  - Blank startup and no console errors were confirmed.
  - Output folder creation, folder validation, runtime check, and tutorial run were executed from Chrome.
  - Tutorial report produced: `outputs/chrome_qc_20260606_1240/reports/brain_volumes_20260606_124002.xlsx`.
  - Progress moved during segmentation and reached 100% after completion.
  - Report detail, structure table, QC view, Excel route, PDF route, color QC route, and binary QC route were verified.
  - `Open color QC` and `Open outline QC` opened image tabs in Chrome.
  - Server was restarted and the saved report was reloaded successfully from the Reports panel.
- README user guide.
  - Root `README.md` now describes setup, launch, folder selection, running analysis, saved reports, downloads, QC, output files, troubleshooting, and optional CLI paths.
  - Subagent review feedback was applied for repo-root command context.
  - `docs/ARCHITECTURE.md` was corrected so PDF output is described as an on-demand download route rather than a required persisted file.
- Final automated acceptance slice after README update.
  - Frontend tests passed.
  - Frontend production build passed.
  - Backend tests passed.
  - Production UI launched through `./tools/launch_ui.sh --port 8779`.
  - Blank startup and no Chrome console warnings/errors were confirmed.
  - Saved report `outputs/chrome_qc_20260606_1240/reports/brain_volumes_20260606_124002.xlsx` loaded from the Reports panel.
  - Structure table, QC inspection images, and artifact routes were verified.
- Narrow viewport acceptance check.
  - Production app was rendered in a fixed-width 390px iframe harness because Chrome automation cannot resize the actual browser window.
  - Startup controls, blank results state, saved report loading, artifact buttons, structure/QC segmented switch, and QC images were verified at 390px.
  - Chrome console logs had no warnings/errors.
  - Screenshots were saved under `outputs/final_acceptance_20260606/`.

## 1. Remaining Final MVP Acceptance

Planned work:

- Manually click native input/results folder picker buttons on macOS.
  - Backend picker route and macOS AppleScript/cancel tests already pass.
  - Remaining verification is the real OS dialog interaction: click picker, choose a folder, confirm the UI path populates, and confirm no crash or `failed to fetch`.
