# Open OnDemand Batch App Plan

## Summary

The doctor-facing HiPerGator workflow should be an Open OnDemand batch submitter.

The user fills in a browser form with an input folder, output folder, optional email, and Slurm resource settings. Open OnDemand submits a normal Slurm GPU job. The browser can be closed while the job waits in the queue. Slurm sends email on job completion or failure when an email address is provided.

This is better than an interactive GPU web app for long queues because the UI does not need to stay alive while waiting for a GPU.

## Current Architecture

- The Python CLI remains the source of truth: `python -m volumetric_analysis.run`.
- The Apptainer image packages FastSurfer and this project.
- The OOD app submits one Slurm job that runs the CLI inside Apptainer.
- Users upload or manage scans separately through OOD Files, Globus, or another HiPerGator transfer method.

Status: scaffolded, but not yet validated end to end on HiPerGator. Do not
present this as doctor-ready until the Apptainer image path, Slurm
account/partition, and one real GPU submission have succeeded.

## User Flow

1. Log into HiPerGator Open OnDemand.
2. Upload scans to `/blue/...` or `/orange/...`.
3. Open the Brain Volume Analysis OOD app.
4. Enter input folder, output folder, optional email, and resource settings.
5. Click `Launch`.
6. Wait for Slurm to schedule the GPU job.
7. Receive email on `END` or `FAIL` if email was provided.
8. Read outputs from the selected output folder.

## Output Files

- `reports/brain_volumes_<timestamp>.xlsx`
- `example_segmentation.mgz`
- `example_qc_color.png`
- `runs/<timestamp>/fastsurfer/...`

## Deployment Pieces

- Apptainer image build files: `deploy/apptainer/`
- OOD batch app files: `deploy/ood/brain_volume_analysis/`
- OOD installation notes: `deploy/ood/README.md`

## Assumptions

- Input is path-based only for this version.
- DICOM support is out of scope.
- Users authenticate through UF/HiPerGator/Open OnDemand.
- The OOD app does not store data or credentials.
- First production target is HiPerGator CUDA with Apptainer.

## References

- [UFRC Open OnDemand docs](https://docs.rc.ufl.edu/interfaces/ood/)
- [UFRC OOD Files docs](https://docs.rc.ufl.edu/data_transfer/ood_files/)
- [UFRC Apptainer docs](https://docs.rc.ufl.edu/software/apps/apptainer/)
