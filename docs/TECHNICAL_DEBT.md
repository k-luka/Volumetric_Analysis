# Technical Debt Tracker

This tracks engineering work we can do now. Doctor-dependent scientific decisions belong in `docs/CURRENT_SPEC.md`.

## Priority

1. Add DICOM support.

   The alpha only reads `.nii` and `.nii.gz`. A doctor-facing workflow will likely need DICOM folder import, metadata reading, and conversion to NIfTI before segmentation.

2. Install and test the Open OnDemand batch app.

   The app files are in the repo, but they still need to be installed/tested on HiPerGator, first as a personal/dev OOD app or Job Composer script, then through UFRC if needed.

3. Package reproducible execution.

   FastSurfer install behavior is convenient but fragile. Create and test the pinned Apptainer image for HiPerGator CUDA runs.

4. Add platform profiles.

   Provide named settings for Mac smoke tests, CUDA batch runs, and CPU fallback instead of relying on manual CLI overrides.

5. Improve input folder hygiene.

   The scanner processes every `.nii` and `.nii.gz` file it sees. Add include/exclude rules so users do not accidentally process derived outputs.

6. Add per-scan QC outputs.

   The alpha intentionally overwrites one example QC set. A practical workflow should save QC images per subject, at least optionally.

7. Write run metadata.

   Save a small run log with FastSurfer version, command options, config, timestamps, input file list, and citation notes.

8. Add automated tests.

   Cover scan discovery, subject ID generation, spacing validation, volume math, report schema, and command construction.

9. Generate a third-party license report.

   The main licenses are documented, but a polished package should include transitive dependency license output.

10. Polish the Excel report.

    Add frozen headers, units, run metadata, and a citation/settings sheet when the report format stabilizes.

## Lower Priority

- Add manual voxel-spacing correction through a CSV or config override.
- Compare voxel-count volume against FastSurfer stats as an internal sanity check.
- Consider splitting the runner into modules if the file grows beyond the alpha scope.
