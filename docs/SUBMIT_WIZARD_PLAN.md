# Submit Wizard Plan

## Problem

The OOD batch app requires UFRC sysadmin action to enable per-user developer apps.
Until that is resolved (or instead of it), doctors need another way to submit jobs.

## Proposed Solution

An interactive shell wizard script (`deploy/wizard/submit_job.sh`) that lives on
HiPerGator. The doctor opens a terminal — either via OOD Shell or a regular SSH
session — runs one command, answers a few prompts, and a Slurm job is submitted.

No local software to install. No SSH key configuration. No sysadmin involvement.

## Doctor Workflow

1. Log into HiPerGator Open OnDemand at `https://ood.rc.ufl.edu`.
2. Click **Clusters → HiPerGator Shell Access** to open a browser terminal.
3. Run:
   ```bash
   bash /blue/pinaki.sarder/kirill.luka/Volumetric_Analysis/deploy/wizard/submit_job.sh
   ```
4. Answer the prompts (see below).
5. The script prints the Slurm job ID and exits.
6. Optionally receive email when the job finishes or fails.
7. Find outputs in the chosen output folder.

## Prompts (in order)

| Prompt | Default | Notes |
|---|---|---|
| Input folder | — | Required. Must exist on HiPerGator. |
| Output folder | — | Required. Created if it does not exist. |
| Search subfolders? | no | yes/no |
| Email for notification | — | Optional. Leave blank to skip. |
| Wall time in hours | 24 | |
| CPU cores | 4 | |
| Memory in GB | 32 | |

Resource prompts should show the default and accept Enter to keep it, so the
doctor can skip through them quickly for a typical run.

## What the Script Does

1. Validates that the input folder exists.
2. Creates the output folder if missing (`mkdir -p`).
3. Confirms choices with a summary before submitting.
4. Calls `sbatch` with the Apptainer job script, passing all values as environment
   variables.
5. Prints the job ID on success.

## Script Structure

Three files:

```
deploy/wizard/
  connect.sh         # laptop launcher — SSHes into HiPerGator (Duo), runs the wizard
  submit_job.sh      # interactive wizard — asks questions, calls sbatch
  job.sh             # non-interactive Slurm batch script — runs apptainer
```

`connect.sh` is the one command a doctor runs on their own laptop; it logs in
and starts `submit_job.sh` over SSH. `submit_job.sh` is the wizard that runs on
HiPerGator. `job.sh` is what Slurm executes.
`job.sh` reads settings from environment variables exported by `sbatch --export`.

This split keeps the interactive logic separate from the job logic and makes
`job.sh` independently testable.

## Job Script Behavior

`job.sh` mirrors the existing OOD `template/script.sh.erb`, minus the ERB
templating:

- Loads the `apptainer` module.
- Validates the image path and input folder.
- Binds `/blue`, `/orange`, `/scratch`, `/ufrc`, `$TMPDIR`.
- Runs `apptainer exec --nv` with `python -m volumetric_analysis.run`.
- Passes `input_dir`, `output_dir`, `recursive`, and the fixed container-side
  FastSurfer settings.

## Hardcoded Values (not prompted)

- Apptainer image: `/blue/pinaki.sarder/kirill.luka/containers/volumetric-analysis_cuda-v2.4.2.sif`
- Slurm account: `pinaki.sarder`
- Partition: `hpg-turin`
- GPU count: 1
- Job name: `brain-volume-analysis`

These can be overridden by editing the script or adding optional flags later.
Keep them hardcoded for the alpha to reduce doctor-facing complexity.

## Open Questions Before Implementation

- Confirm the partition (`hpg-turin`) is the right target for this workload.
- Confirm the Slurm account (`pinaki.sarder`) is correct for all expected users.
- Decide whether to add a `--qos` prompt or hardcode/omit it.
- Decide whether to show a progress tail (e.g. `squeue -j <jobid>` loop) or
  just print the job ID and exit.

## Out of Scope for Alpha

- A local launcher that SSHes in from the doctor's laptop (requires SSH key setup
  and per-OS testing — more complexity than OOD Shell).
- A web form replacement built from scratch.
- Job cancellation or status checking from within the wizard.

## Relationship to OOD App

The wizard and the OOD batch app share the same Apptainer image and the same
underlying job logic. If UFRC enables dev apps, the OOD form can be deployed
alongside the wizard. They are not mutually exclusive.
