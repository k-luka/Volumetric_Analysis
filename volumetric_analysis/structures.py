"""Per-structure brain volumes from a FastSurfer/FreeSurfer segmentation.

The segmentation FastSurfer writes (``aparc.DKTatlas+aseg.deep.mgz``) labels
every voxel with a FreeSurfer structure id: subcortical aseg ids (e.g. 17 =
left hippocampus) plus a cortical parcellation in the 1000s (left hemisphere)
and 2000s (right hemisphere). ``run.py`` only counts non-zero voxels for a
single whole-brain total; this module turns the same file into clinically
meaningful per-structure volumes.

Everything here is pure measurement (voxel counts x voxel volume). It does not
diagnose anything and deliberately reports no reference ranges or normal values.
"""
from __future__ import annotations

import re
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd


# Highest FreeSurfer label id we expose in the catalog (rh cortex = 2000-2035).
# The Slices/3D viewer sizes its recolor LUT as (MAX_LABEL + 1) entries.
MAX_LABEL = 2035


def _crange(lo: int, hi: int) -> list[int]:
    return list(range(lo, hi + 1))


# Cortical parcellation labels: lh = 1000-1035, rh = 2000-2035 in the DKT atlas.
# We sum the whole hemisphere into a single "Cerebral cortex" structure rather
# than expose ~35 parcels per side, which a clinician does not want to scan.
_LH_CORTEX = _crange(1000, 1035)
_RH_CORTEX = _crange(2000, 2035)


# Bilateral structures: (display name, group, left ids, right ids).
_BILATERAL: list[tuple[str, str, list[int], list[int]]] = [
    ("Cerebral cortex", "Cerebrum", _LH_CORTEX, _RH_CORTEX),
    ("Cerebral white matter", "Cerebrum", [2], [41]),
    ("Lateral ventricle", "Ventricles", [4, 5], [43, 44]),
    ("Thalamus", "Deep grey matter", [9, 10], [48, 49]),
    ("Caudate", "Deep grey matter", [11], [50]),
    ("Putamen", "Deep grey matter", [12], [51]),
    ("Pallidum", "Deep grey matter", [13], [52]),
    ("Hippocampus", "Medial temporal", [17], [53]),
    ("Amygdala", "Medial temporal", [18], [54]),
    ("Accumbens", "Deep grey matter", [26], [58]),
    ("Ventral diencephalon", "Deep grey matter", [28], [60]),
    ("Cerebellar cortex", "Cerebellum", [8], [47]),
    ("Cerebellar white matter", "Cerebellum", [7], [46]),
]

# Midline / unpaired structures: (display name, group, ids).
_MIDLINE: list[tuple[str, str, list[int]]] = [
    ("Brainstem", "Brainstem", [16]),
    ("Third ventricle", "Ventricles", [14]),
    ("Fourth ventricle", "Ventricles", [15]),
]

# Labels that are fluid/CSF rather than brain parenchyma. Used to derive a
# parenchyma total (whole brain minus ventricles/CSF).
_CSF_LABELS = {4, 5, 43, 44, 14, 15, 24, 31, 63, 72}


def _slug(name: str) -> str:
    """Stable URL/JS-friendly key for a structure display name."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def atlas_regions() -> list[dict]:
    """The canonical atlas catalog shared with ``structure_volumes``.

    One entry per structure (~16 total) with every FreeSurfer label id it
    covers, built from the SAME ``_BILATERAL`` / ``_MIDLINE`` definitions that
    drive the volume table so the two can never drift. Bilateral entries merge
    left + right ids (e.g. Hippocampus -> [17, 53]); "Cerebral cortex" expands
    to 1000..1035 + 2000..2035; midline structures keep their own ids.
    """
    regions: list[dict] = []
    for name, group, left_ids, right_ids in _BILATERAL:
        regions.append(
            {
                "key": _slug(name),
                "name": name,
                "group": group,
                "labels": list(left_ids) + list(right_ids),
            }
        )
    for name, group, ids in _MIDLINE:
        regions.append(
            {
                "key": _slug(name),
                "name": name,
                "group": group,
                "labels": list(ids),
            }
        )
    return regions


def _voxel_ml(seg: "nib.spatialimages.SpatialImage") -> float:
    zooms = tuple(float(v) for v in seg.header.get_zooms()[:3])
    if len(zooms) != 3 or any(not np.isfinite(v) or v <= 0 for v in zooms):
        raise ValueError("Invalid voxel spacing in segmentation")
    return float(np.prod(zooms)) / 1000.0  # mm^3 -> mL


def label_counts(seg_path: Path) -> tuple[dict[int, int], float, tuple[float, float, float]]:
    """Return ({label_id: voxel_count}, voxel_volume_ml, spacing_mm)."""
    seg = nib.load(str(seg_path))
    data = np.asarray(seg.dataobj)
    ids, counts = np.unique(data, return_counts=True)
    spacing = tuple(float(v) for v in seg.header.get_zooms()[:3])
    return {int(i): int(c) for i, c in zip(ids, counts)}, _voxel_ml(seg), spacing


def _sum_ml(counts: dict[int, int], ids: list[int], vox_ml: float) -> float:
    return float(sum(counts.get(i, 0) for i in ids)) * vox_ml


def asymmetry_pct(left: float, right: float) -> float | None:
    """Signed L-R asymmetry as a percent of the mean. Positive = left larger."""
    mean = (left + right) / 2.0
    if mean <= 0:
        return None
    return round((left - right) / mean * 100.0, 1)


def structure_volumes(seg_path: Path) -> pd.DataFrame:
    """One row per structure with left/right/total mL and asymmetry.

    Columns: structure, group, side, left_ml, right_ml, total_ml,
    asymmetry_pct, pct_of_brain.
    """
    counts, vox_ml, _ = label_counts(seg_path)
    total_brain_ml = float(sum(c for lid, c in counts.items() if lid != 0)) * vox_ml

    rows: list[dict[str, object]] = []
    for name, group, left_ids, right_ids in _BILATERAL:
        left = _sum_ml(counts, left_ids, vox_ml)
        right = _sum_ml(counts, right_ids, vox_ml)
        total = left + right
        rows.append(
            {
                "structure": name,
                "group": group,
                "side": "bilateral",
                "left_ml": round(left, 2),
                "right_ml": round(right, 2),
                "total_ml": round(total, 2),
                "asymmetry_pct": asymmetry_pct(left, right),
                "pct_of_brain": round(total / total_brain_ml * 100.0, 2) if total_brain_ml else None,
            }
        )
    for name, group, ids in _MIDLINE:
        total = _sum_ml(counts, ids, vox_ml)
        rows.append(
            {
                "structure": name,
                "group": group,
                "side": "midline",
                "left_ml": None,
                "right_ml": None,
                "total_ml": round(total, 2),
                "asymmetry_pct": None,
                "pct_of_brain": round(total / total_brain_ml * 100.0, 2) if total_brain_ml else None,
            }
        )
    return pd.DataFrame(rows)


def brain_totals(seg_path: Path) -> dict[str, float]:
    """Whole-brain summary totals in mL."""
    counts, vox_ml, _ = label_counts(seg_path)
    nonzero = {lid: c for lid, c in counts.items() if lid != 0}
    total = float(sum(nonzero.values())) * vox_ml
    csf = float(sum(c for lid, c in nonzero.items() if lid in _CSF_LABELS)) * vox_ml
    ventricles = _sum_ml(counts, [4, 5, 43, 44, 14, 15], vox_ml)
    return {
        "total_brain_ml": round(total, 1),
        "parenchyma_ml": round(total - csf, 1),
        "ventricular_ml": round(ventricles, 1),
    }
