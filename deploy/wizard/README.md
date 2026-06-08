# Submit Wizard

A terminal tool for submitting a brain volume analysis job on HiPerGator without
the Open OnDemand form (which requires UFRC to enable per-user developer apps).

Three files:

- `connect.sh` — **the one command a doctor runs on their own laptop.** Logs into
  HiPerGator (Duo), then starts the wizard there.
- `submit_job.sh` — the wizard that runs on HiPerGator. Asks a few questions, then calls `sbatch`.
- `job.sh` — what Slurm runs. Loads Apptainer and runs the analysis container.

```
[doctor's laptop]                      [HiPerGator]
connect.sh  ── ssh -t ──▶  submit_job.sh ── sbatch ──▶  job.sh ──▶ apptainer
(one command, Duo here)    (asks folders)
```

## For doctors

You need: a HiPerGator account with Duo, your scans already copied to a
HiPerGator folder under `/blue` (via OOD Files or Globus), and our launcher
folder on your computer.

1. Open a terminal (Terminal on macOS, PowerShell on Windows).
2. Run the launcher from our folder:

   ```bash
   bash connect.sh
   ```

3. Enter your GatorLink username and password, then **approve the Duo push on
   your phone** when prompted.
4. The wizard starts automatically. Answer the prompts:

   | Prompt | Default | Notes |
   |---|---|---|
   | Input folder | — | A HiPerGator folder that already holds your `.nii` / `.nii.gz` scans. |
   | Output folder | — | Created if it does not exist. |
   | Search subfolders? | no | Answer `y` to also scan subfolders. |
   | Email | — | Optional. Slurm emails you when the job ends or fails. |
   | Wall time (hours) | 24 | Press Enter to keep. |
   | CPU cores | 4 | Press Enter to keep. |
   | Memory (GB) | 32 | Press Enter to keep. |

5. Review the summary and confirm. The tool prints the job ID and how to check
   on it. You can close the terminal — the job runs on the cluster.
6. Find results in `your-output-folder/reports/` when the job finishes.

### Alternative: OOD Shell (no launcher)

If you'd rather not use the laptop launcher, you can log into
<https://ood.rc.ufl.edu>, open **Clusters → HiPerGator Shell Access**, and run
the wizard directly:

```bash
bash /blue/pinaki.sarder/kirill.luka/Volumetric_Analysis/deploy/wizard/submit_job.sh
```

## For maintainers

### Test without connecting or submitting

Both scripts have a `--dry-run` that prints the command they would run and stops.
Neither needs Slurm or a real connection, so they work on macOS for testing:

```bash
bash deploy/wizard/connect.sh --dry-run     # prints the ssh command
bash deploy/wizard/submit_job.sh --dry-run  # asks questions, prints the sbatch command
```

### Launcher settings

Edit the variables at the top of `connect.sh` if the deployment moves:

- `REMOTE_HOST` — `hpg.ufl.edu`
- `REMOTE_DIR` — where this wizard folder lives on HiPerGator
- `DEFAULT_USER` — optional GatorLink default so doctors skip the username prompt

The launcher assumes the repo is already cloned on HiPerGator at `REMOTE_DIR`.
Each doctor uses their own GatorLink account (do not share one account).

### Values hardcoded in the alpha

Set in `job.sh` (and the summary in `submit_job.sh`), not prompted:

- Apptainer image: `/blue/pinaki.sarder/kirill.luka/containers/volumetric-analysis_cuda-v2.4.2.sif`
- Slurm account: `pinaki.sarder`
- Partition: `hpg-turin`
- GPUs: `1`
- Job name: `brain-volume-analysis`
- QoS: omitted (relies on account defaults)

Override the image path without editing the file by exporting `APPTAINER_IMAGE`
before running `job.sh`.

### Status

The underlying `sbatch` + `apptainer exec` command has **not yet run on
HiPerGator** — it mirrors the untested OOD `template/script.sh.erb`. The first
real submission is also the first end-to-end test of the job. Confirm the
partition (`hpg-turin`), account (`pinaki.sarder`), and image path are correct
for the submitting user before relying on it.

### Relationship to the OOD app

This wizard and `deploy/ood/brain_volume_analysis/` share the same Apptainer
image and the same core command. They are not mutually exclusive: if UFRC
enables dev apps later, the OOD form can be deployed alongside the wizard.
