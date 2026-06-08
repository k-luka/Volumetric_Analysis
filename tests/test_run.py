from __future__ import annotations

import tempfile
import unittest
import importlib.util
from pathlib import Path

for module in ("hydra", "nibabel", "numpy", "pandas", "openpyxl"):
    if importlib.util.find_spec(module) is None:
        raise unittest.SkipTest(f"{module} is not installed")

import nibabel as nib
import numpy as np

from volumetric_analysis.run import (
    REPORT_COLUMNS,
    compute_volume,
    find_scans,
    subject_id_from_filename,
    unique_subject_ids,
    write_report,
)


class RunHelpersTest(unittest.TestCase):
    def test_find_scans_supports_nii_and_nii_gz(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.nii").touch()
            (root / "b.nii.gz").touch()
            (root / "skip.txt").touch()
            nested = root / "nested"
            nested.mkdir()
            (nested / "c.nii").touch()

            self.assertEqual([path.name for path in find_scans(root, recursive=False)], ["a.nii", "b.nii.gz"])
            self.assertEqual(
                [path.name for path in find_scans(root, recursive=True)],
                ["a.nii", "b.nii.gz", "c.nii"],
            )

    def test_subject_ids_are_sanitized_and_unique(self) -> None:
        scans = [Path("Subject 1.nii.gz"), Path("Subject 1.nii"), Path("***.nii")]

        self.assertEqual(subject_id_from_filename(scans[0]), "Subject_1")
        self.assertEqual(subject_id_from_filename(scans[2]), "scan")
        self.assertEqual(
            unique_subject_ids(scans),
            {
                scans[0]: "Subject_1",
                scans[1]: "Subject_1_2",
                scans[2]: "scan",
            },
        )

    def test_compute_volume_counts_nonzero_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "seg.nii"
            data = np.zeros((2, 2, 2), dtype=np.int16)
            data[0, 0, 0] = 1
            data[1, 1, 1] = 7
            affine = np.diag([2.0, 3.0, 4.0, 1.0])
            nib.save(nib.Nifti1Image(data, affine), str(path))

            voxel_count, spacing, volume_mm3, volume_ml = compute_volume(path)

            self.assertEqual(voxel_count, 2)
            self.assertEqual(spacing, (2.0, 3.0, 4.0))
            self.assertEqual(volume_mm3, 48.0)
            self.assertEqual(volume_ml, 0.048)

    def test_write_report_uses_expected_schema(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_report([], Path(tmp), "brain_volumes", "test")

            self.assertTrue(path.exists())
            self.assertEqual(path.name, "brain_volumes_test.xlsx")
            self.assertEqual(REPORT_COLUMNS[0], "filename")
            self.assertEqual(REPORT_COLUMNS[-1], "error")


if __name__ == "__main__":
    unittest.main()
