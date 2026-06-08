"""Screenshot the local web UI for visual inspection.

Usage:
    python tools/shot.py [out.png] [--url http://localhost:8765/] [--width 1440] [--height 900] [--full]

Framework-agnostic: waits for network idle and the app mount node before
capturing. Defaults to the FastAPI/React app on port 8765.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_URL = "http://localhost:8765/"


def main() -> None:
    args = sys.argv[1:]
    out = Path(args[0]) if args and not args[0].startswith("--") else Path("/tmp/vol_ui.png")
    url = DEFAULT_URL
    width = 1440
    height = 900
    full = "--full" in args
    if "--url" in args:
        url = args[args.index("--url") + 1]
    if "--width" in args:
        width = int(args[args.index("--width") + 1])
    if "--height" in args:
        height = int(args[args.index("--height") + 1])

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": width, "height": height},
                                   device_scale_factor=2).new_page()
        page.goto(url, wait_until="networkidle")
        # React mounts into #root; fall back to <body> if the id ever changes.
        try:
            page.wait_for_selector("#root", timeout=15000)
        except Exception:
            page.wait_for_selector("body", timeout=15000)
        page.wait_for_timeout(1200)
        page.screenshot(path=str(out), full_page=full)
        browser.close()
    print(f"saved {out}")


if __name__ == "__main__":
    main()
