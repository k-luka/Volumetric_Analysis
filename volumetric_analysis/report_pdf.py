"""Render a clean one-page PDF volume report for a research run.

Uses matplotlib (already a dependency) so there is no extra install. The layout
is intentionally simple: a titled header, optional subject/scan identifiers, a
whole-brain totals band, and a per-structure table. It reports measured volumes
only - it deliberately does not assert reference ranges or normal values.
"""
from __future__ import annotations

import io
from datetime import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

import pandas as pd

INK = "#22242a"
MUTED = "#686c75"
ACCENT = "#e43f68"
LINE = "#d7d4cd"

FOOTER_NOTE = (
    "Volumes derived from automated segmentation (FastSurfer, DKT atlas). "
    "Measured values only - no reference ranges or normative comparison are implied. For research use."
)


def _fmt(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "-"
    if isinstance(value, float):
        return f"{value:,.1f}"
    return str(value)


def build_pdf_report(
    scan_info: dict[str, object],
    totals: dict[str, float],
    structures: pd.DataFrame,
) -> bytes:
    """Return PDF bytes for the given scan/volume data (anonymous research run)."""
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        fig = plt.figure(figsize=(8.27, 11.69))  # A4 portrait
        ax = fig.add_axes([0, 0, 1, 1])
        ax.axis("off")

        def text(x, y, s, size=10, color=INK, weight="normal", family="sans-serif", ha="left"):
            ax.text(x, y, s, fontsize=size, color=color, fontweight=weight,
                    family=family, ha=ha, transform=ax.transAxes)

        # Header
        text(0.07, 0.955, "BRAIN VOLUME REPORT", size=9, color=ACCENT, weight="bold", family="monospace")
        text(0.07, 0.93, "Volumetric Analysis", size=20, weight="bold")
        text(0.93, 0.945, datetime.now().strftime("Generated %Y-%m-%d %H:%M"),
             size=8, color=MUTED, family="monospace", ha="right")
        ax.plot([0.07, 0.93], [0.915, 0.915], color=LINE, lw=1, transform=ax.transAxes)

        # Scan identifiers (research runs are anonymous — no patient fields).
        fields = [
            ("Subject", scan_info.get("subject") or scan_info.get("filename") or "-"),
            ("Scan resolution", scan_info.get("spacing") or "-"),
        ]
        y = 0.892
        col_x = [0.07, 0.4, 0.66]
        for i, (k, v) in enumerate(fields):
            x = col_x[i % 3]
            yy = y - (i // 3) * 0.04
            text(x, yy, k.upper(), size=7, color=MUTED, weight="bold", family="monospace")
            text(x, yy - 0.018, _fmt(v), size=10, weight="bold")

        # Totals band
        y = 0.80
        text(0.07, y, "WHOLE-BRAIN TOTALS", size=8, color=MUTED, weight="bold", family="monospace")
        band = [
            ("Brain parenchyma", f"{_fmt(totals.get('parenchyma_ml'))} mL"),
            ("Total segmented", f"{_fmt(totals.get('total_brain_ml'))} mL"),
            ("Ventricular volume", f"{_fmt(totals.get('ventricular_ml'))} mL"),
        ]
        for i, (k, v) in enumerate(band):
            x = 0.07 + i * 0.30
            text(x, y - 0.03, v, size=15, weight="bold")
            text(x, y - 0.052, k, size=8, color=MUTED)

        # Structure table
        y0 = 0.715
        text(0.07, y0, "STRUCTURE VOLUMES", size=8, color=MUTED, weight="bold", family="monospace")
        ax.plot([0.07, 0.93], [y0 - 0.012, y0 - 0.012], color=LINE, lw=1, transform=ax.transAxes)
        headers = ["Structure", "Region", "Left (mL)", "Right (mL)", "Total (mL)", "Asym %"]
        hx = [0.07, 0.34, 0.56, 0.68, 0.80, 0.90]
        hy = y0 - 0.03
        for hxx, h in zip(hx, headers):
            text(hxx, hy, h, size=8, color=MUTED, weight="bold", family="monospace")

        row_y = hy - 0.022
        for _, r in structures.iterrows():
            cells = [
                str(r["structure"]),
                str(r["group"]),
                _fmt(r["left_ml"]),
                _fmt(r["right_ml"]),
                _fmt(r["total_ml"]),
                _fmt(r["asymmetry_pct"]),
            ]
            for hxx, c in zip(hx, cells):
                text(hxx, row_y, c, size=8.5, color=INK)
            row_y -= 0.0205

        # Footer
        ax.plot([0.07, 0.93], [0.07, 0.07], color=LINE, lw=1, transform=ax.transAxes)
        ax.text(0.07, 0.05, FOOTER_NOTE, fontsize=7.5, color=MUTED, family="sans-serif",
                ha="left", va="top", wrap=True, transform=ax.transAxes)

        pdf.savefig(fig)
        plt.close(fig)
    buf.seek(0)
    return buf.getvalue()
