from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

for module in ("nibabel", "numpy", "pandas"):
    if importlib.util.find_spec(module) is None:
        raise unittest.SkipTest(f"{module} is not installed")

import nibabel as nib
import numpy as np
import pandas as pd

import volumetric_analysis.structures as structures
from volumetric_analysis.structures import MAX_LABEL, atlas_regions, structure_volumes


# A synthetic segmentation whose label set spans every structure family the
# catalog cares about: bilateral subcortical, cortex (lh + rh edges), and
# midline. Reused by both the catalog and golden tests.
_SYNTHETIC_LABELS = [
    0,  # background
    2, 41,  # cerebral white matter L/R
    17, 53,  # hippocampus L/R
    16,  # brainstem (midline)
    14,  # third ventricle (midline)
    1000, 1035,  # lh cortex edges
    2000, 2035,  # rh cortex edges
]


def _write_synthetic_seg(path: Path) -> None:
    # One distinct voxel per label, laid out along the x axis. 2mm isotropic so
    # each voxel is 8 mm^3 = 0.008 mL, giving deterministic volumes.
    labels = _SYNTHETIC_LABELS
    data = np.zeros((len(labels), 1, 1), dtype=np.int16)
    for i, lid in enumerate(labels):
        data[i, 0, 0] = lid
    affine = np.diag([2.0, 2.0, 2.0, 1.0])
    nib.save(nib.Nifti1Image(data, affine), str(path))


class AtlasCatalogTest(unittest.TestCase):
    def test_max_label_is_2035(self) -> None:
        self.assertEqual(MAX_LABEL, 2035)

    def test_catalog_has_expected_structure_count(self) -> None:
        regions = atlas_regions()
        self.assertEqual(len(regions), 16)

    def test_every_region_has_required_fields_and_nonempty_labels(self) -> None:
        for region in atlas_regions():
            self.assertEqual(set(region), {"key", "name", "group", "labels"})
            self.assertTrue(region["key"])
            self.assertTrue(region["name"])
            self.assertTrue(region["group"])
            self.assertTrue(region["labels"], f"{region['name']} has no labels")
            self.assertTrue(all(isinstance(lid, int) for lid in region["labels"]))

    def test_region_keys_are_unique(self) -> None:
        keys = [region["key"] for region in atlas_regions()]
        self.assertEqual(len(keys), len(set(keys)))

    def test_no_label_exceeds_max_label(self) -> None:
        for region in atlas_regions():
            for lid in region["labels"]:
                self.assertLessEqual(lid, MAX_LABEL)

    def test_hippocampus_merges_left_and_right_ids(self) -> None:
        region = next(r for r in atlas_regions() if r["name"] == "Hippocampus")
        self.assertEqual(region["labels"], [17, 53])

    def test_cerebral_cortex_spans_both_hemisphere_ranges(self) -> None:
        region = next(r for r in atlas_regions() if r["name"] == "Cerebral cortex")
        for lid in (1000, 1035, 2000, 2035):
            self.assertIn(lid, region["labels"])

    def test_cerebral_cortex_is_the_full_contiguous_range(self) -> None:
        # The cortex region must contain the COMPLETE lh (1000..1035) + rh
        # (2000..2035) ranges with no gaps -- 72 ids -- so the recolor LUT never
        # leaves an interior cortex label at the base color. Pins the whole range,
        # not just the four endpoints, so a step/sub-range edit is caught.
        region = next(r for r in atlas_regions() if r["name"] == "Cerebral cortex")
        expected = list(range(1000, 1036)) + list(range(2000, 2036))
        self.assertEqual(region["labels"], expected)
        self.assertEqual(len(region["labels"]), 72)

    def test_catalog_labels_have_no_duplicates(self) -> None:
        # The spec's "no overlaps / one label per voxel" invariant the LUT relies
        # on: no id may appear twice within a region or across regions.
        all_labels: list[int] = []
        for region in atlas_regions():
            self.assertEqual(
                len(region["labels"]),
                len(set(region["labels"])),
                f"{region['name']} has duplicate labels",
            )
            all_labels.extend(region["labels"])
        self.assertEqual(
            len(all_labels),
            len(set(all_labels)),
            "atlas catalog has labels shared across regions",
        )

    def test_catalog_matches_structure_volumes_source_no_drift(self) -> None:
        # Core no-drift guarantee: the recolor catalog and the measured volume
        # table are both built from _BILATERAL / _MIDLINE, so the catalog's label
        # set must EQUAL the union of every id structure_volumes sums, and each
        # named region's labels must match that structure's ids exactly. Built
        # directly from the source lists so a typo'd id (or a structure added to
        # one list but not the other) breaks this test rather than silently
        # drifting the recolor mapping from the numbers shown to the clinician.
        regions_by_name = {r["name"]: r for r in atlas_regions()}

        expected_union: set[int] = set()
        for name, _group, left_ids, right_ids in structures._BILATERAL:
            expected_labels = list(left_ids) + list(right_ids)
            self.assertIn(name, regions_by_name)
            self.assertEqual(
                regions_by_name[name]["labels"],
                expected_labels,
                f"{name} catalog labels drifted from its volume-table ids",
            )
            expected_union.update(expected_labels)
        for name, _group, ids in structures._MIDLINE:
            self.assertIn(name, regions_by_name)
            self.assertEqual(
                regions_by_name[name]["labels"],
                list(ids),
                f"{name} catalog labels drifted from its volume-table ids",
            )
            expected_union.update(ids)

        catalog_union = {lid for r in atlas_regions() for lid in r["labels"]}
        self.assertEqual(
            catalog_union,
            expected_union,
            "catalog label set is not exactly the union of structure_volumes ids",
        )

    def test_golden_structure_volumes_unchanged_by_refactor(self) -> None:
        # The catalog refactor must not move a single number in the volume table.
        # These rows are computed by hand from _SYNTHETIC_LABELS at 0.008 mL/voxel.
        with tempfile.TemporaryDirectory() as tmp:
            seg_path = Path(tmp) / "seg.mgz"
            _write_synthetic_seg(seg_path)
            df = structure_volumes(seg_path)

        rows = {row["structure"]: row for _, row in df.iterrows()}

        # Cerebral white matter: L=2 -> 0.008, R=41 -> 0.008, total 0.016.
        wm = rows["Cerebral white matter"]
        self.assertEqual(wm["left_ml"], 0.01)
        self.assertEqual(wm["right_ml"], 0.01)
        self.assertEqual(wm["total_ml"], 0.02)
        self.assertEqual(wm["asymmetry_pct"], 0.0)

        # Hippocampus: L=17, R=53, one voxel each.
        hippo = rows["Hippocampus"]
        self.assertEqual(hippo["left_ml"], 0.01)
        self.assertEqual(hippo["right_ml"], 0.01)
        self.assertEqual(hippo["total_ml"], 0.02)

        # Cerebral cortex: 1000, 1035 (lh) + 2000, 2035 (rh) -> 2 voxels per side.
        # left = right = round(2 * 0.008, 2) = round(0.016, 2) = 0.02, but
        # total = round(left+right, 2) = round(0.032, 2) = 0.03 (rounded once,
        # NOT the sum of the rounded sides) -- this is the exact pre-refactor
        # behaviour the golden test pins down.
        cortex = rows["Cerebral cortex"]
        self.assertEqual(cortex["left_ml"], 0.02)
        self.assertEqual(cortex["right_ml"], 0.02)
        self.assertEqual(cortex["total_ml"], 0.03)

        # Brainstem (midline, label 16): one voxel, no left/right. The volume
        # table stores None for midline sides; pandas surfaces it as NaN.
        brainstem = rows["Brainstem"]
        self.assertEqual(brainstem["side"], "midline")
        self.assertTrue(pd.isna(brainstem["left_ml"]))
        self.assertTrue(pd.isna(brainstem["right_ml"]))
        self.assertEqual(brainstem["total_ml"], 0.01)

        # Structures with no matching voxels stay at 0.0, not NaN/None.
        thalamus = rows["Thalamus"]
        self.assertEqual(thalamus["total_ml"], 0.0)


if __name__ == "__main__":
    unittest.main()
