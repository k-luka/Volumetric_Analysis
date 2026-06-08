# Next Steps

Last updated: 2026-06-06

These are the next valid tasks for the local React/FastAPI MVP, in practical execution order.

For the history of completed work, see the changelog in `docs/STATE.md`.

## 1. Remaining Final MVP Acceptance

Planned work:

- Manually click native input/results folder picker buttons on macOS.
  - Backend picker route and macOS AppleScript/cancel tests already pass.
  - Remaining verification is the real OS dialog interaction: click picker, choose a folder, confirm the UI path populates, and confirm no crash or `failed to fetch`.
