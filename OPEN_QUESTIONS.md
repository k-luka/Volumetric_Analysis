# Alpha Scope and Open Questions

## Alpha scope

- Run as a Python command-line tool on HiPerGator or a powerful local machine.
- Target NVIDIA GPU support through FastSurfer.
- Accept `.nii` and `.nii.gz` inputs.
- Assume inputs are mostly T1-weighted 3D MRI scans.
- Segment each scan with FastSurferVINN.
- Compute whole-brain volume as all non-background segmentation labels for alpha.
- Save one example segmentation output for inspection.
- Save one QC image showing multiple slices for the example segmentation.
- Produce a unique Excel report per run.
- Include scan filename, subject ID, volume in mm3, volume in mL, voxel spacing, voxel count, and status/error in the report.
- Use a Hydra YAML config file so runs are easy to configure.
- Use filename-based subject IDs for alpha.
- Skip scans with missing or invalid voxel spacing and report the failure in Excel.
- Keep the alpha minimal: core functionality first, broader checks and exception handling later.
- Expected batch size: about 50 volumes.

## Open questions

- Confirm whether all study scans are T1-weighted 3D MRIs.
- Confirm the desired scientific definition of "whole brain volume."
- Decide whether a future version should support DICOM input directly.
- Decide whether voxel spacing issues should be resolved through a config override, a separate correction CSV, or interactive prompting.
- Confirm the exact FastSurfer version/checkpoints to pin for study reproducibility.
- Confirm the citation language required by the professor or study protocol.
- Confirm all licenses for dependencies used in the final alpha implementation.

## License notes

- FastSurfer is Apache-2.0.
- Hydra is MIT licensed.
- Prefer FastSurfer segmentation-only for alpha.
- Avoid depending on the full FreeSurfer pipeline unless the study explicitly needs it.
- If using a FastSurfer Docker/Singularity image, verify whether the packaged FreeSurfer components affect distribution or deployment requirements.
