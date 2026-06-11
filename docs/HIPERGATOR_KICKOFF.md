# HiPerGator Kickoff — Session Handoff Prompt

> **How to use this file:** This is a context handoff written to be pasted to (or
> read by) a fresh Claude Code session running on UF HiPerGator. It carries the
> state and plan from the prior macOS session. Start your HiPerGator session in
> the repo root and say: *"Read docs/HIPERGATOR_KICKOFF.md and let's start."*

---

## Who you are and what this is

You're picking up the **Volumetric Analysis** project on **UF HiPerGator** (Linux
HPC, Slurm + Apptainer, NVIDIA GPUs). The project extracts per-region brain
volumes from `.nii`/`.nii.gz` MRI scans using FastSurfer (DKT atlas → regional
labels → Excel/PDF report + QC images).

The engine is `python -m volumetric_analysis.run` (Hydra config in `config/`).
Everything is one codebase that runs in three places — local, HPC, cloud — with
the same container; "where it runs" is just routing. Full strategy is in
`docs/PRODUCT_VISION.md`. Today's job is the **HPC backend**.

## Business framing (why this matters, keep it in mind)

The owner's goal is that **UF eventually pays for this software**. Two honest
consequences that should shape your choices:

1. **The plumbing is not the moat.** Nobody writes a site-license check for an
   `sbatch` wrapper. The value is the *experience + interpretation layer* (the
   QC viewer, structure tables, and eventually normative percentiles + PDF) that
   already exists in the local React app. Treat HPC execution as one
   interchangeable backend; don't gold-plate HiPerGator-specific glue.
2. **IP ownership is an open question.** If this is built under a UF affiliation
   or with UF resources, UF may have an ownership claim — which complicates "UF
   pays the owner for it." Flag this; don't try to resolve it in code.

## State of the project as of this handoff

- **Local app: done and polished.** A React/FastAPI app (`./tools/launch_ui.sh`,
  `frontend/`) over the same engine — pick scans → run → live progress →
  cancel/complete → Structures/Slices/3D viewer → download Excel/PDF. 133
  frontend tests pass; all work is committed and pushed to `main`.
- **HiPerGator: scaffolded, NOT validated end-to-end.** This is your job. Nothing
  below has been confirmed to run on a real GPU node yet.

### The decision already reached (don't relitigate)

"Job queuer vs. app" is the wrong axis. On a queue, **headless fire-and-forget
GPU execution is correct for both** — an interactive app should never hold a GPU
while waiting in the queue. The real split is *submit interface* (SSH wizard /
OOD form) vs. *review interface* (currently empty on HPC — both paths just dump
files into a folder; the React UI is the experience and isn't wired to HPC yet).

**The job queuer already exists** (`deploy/wizard/`). So step 1 is not a build —
it's **validation of the foundation** (container + Slurm + CUDA + FastSurfer)
that everything else depends on. Do that first, regardless of the endgame.

## What's already written (read these)

| Path | What it is |
|---|---|
| `deploy/apptainer/Dockerfile` | Image: `FROM deepmi/fastsurfer:cuda-v2.4.2` + this project. ENTRYPOINT runs `volumetric_analysis.run`, device pinned to `cuda`. |
| `deploy/apptainer/README.md` | Build → publish/transfer → SIF → smoke-test recipe. |
| `deploy/wizard/job.sh` | The Slurm batch script. `#SBATCH` defaults: `--gres=gpu:1`, `--account=pinaki.sarder`, `--partition=hpg-turin`, 4 CPU / 32G / 24h. Runs `apptainer exec --nv` over the engine. |
| `deploy/wizard/submit_job.sh` | Interactive wizard: prompts for folders/email/resources, builds + runs `sbatch`. Supports `--dry-run`. |
| `deploy/wizard/connect.sh` | Laptop-side: SSH to HiPerGator + run the wizard. (Not needed when you're already on HPG.) |
| `deploy/ood/brain_volume_analysis/` | Open OnDemand batch app (browser form → Slurm submit). The eventual "institutional product" form. |
| `deploy/ood/README.md` | OOD install notes + the list of site values to confirm with UFRC. |
| `docs/OOD_BATCH_APP_PLAN.md` | The OOD plan and its explicit "not validated" status note. |

### Known environment assumptions baked into the scaffolding (VERIFY before trusting)

- Slurm account `pinaki.sarder`, partition `hpg-turin`, 1 GPU.
- Image path `/blue/pinaki.sarder/kirill.luka/containers/volumetric-analysis_cuda-v2.4.2.sif`.
- Container has FastSurfer at `/fastsurfer/run_fastsurfer.sh`, device `cuda`,
  `fastsurfer.install_if_missing=false` (the image is prebuilt, no network install).
- Bind mounts: `/blue /orange /scratch /ufrc $TMPDIR` when present.

**Confirm these against the real allocation** — partition names, GPU types, and
QoS on HiPerGator change, and `hpg-turin` / `pinaki.sarder` may be stale.

## ⚠️ The image is not in the git clone

The 3.8 GB Docker tarball (`volumetric-analysis_cuda-v2.4.2.tar`) is **gitignored**
(`*.tar`), so cloning the repo on HiPerGator gives you the code and deploy
scripts but **not the image**. Getting the `.sif` onto HiPerGator is a distinct
step. Three options (see `deploy/apptainer/README.md`):

1. **Registry (preferred):** push the Docker image to GHCR from a machine with
   Docker, then on HiPerGator: `apptainer build … docker://ghcr.io/OWNER/…`.
2. **Transfer the tar:** `scp` the 3.8 GB tar to HiPerGator, then
   `apptainer build …_cuda-v2.4.2.sif docker-archive://…tar`.
3. **Build from scratch on HiPerGator** if a Docker→Apptainer path exists there.

The owner has the tar locally on the Mac; ask which route they want before
assuming.

## Your task, in order

Work top-down; each step gates the next. **Stop and report after each — do not
chain blindly.** You cannot reach the GPU yourself the way a normal shell does;
expect to hand the user exact commands to run interactively (Slurm, Duo, module
loads) and interpret the output they paste back.

1. **Land the `.sif` on HiPerGator** (pick a route above with the owner). Confirm
   the file exists at a known path and note it.
2. **Smoke-test the container on a GPU node** (interactive `srun`, not the login
   node):
   - `apptainer exec --nv <sif> python -c "import torch; print(torch.cuda.is_available())"` → expect `True`
   - `apptainer exec --nv <sif> /fastsurfer/run_fastsurfer.sh --version`
3. **One real submission via `deploy/wizard/submit_job.sh`** on a small input
   (a single tutorial scan). Start with `--dry-run` to inspect the `sbatch`
   command, fix any account/partition/QoS mismatch, then submit for real.
4. **Verify outputs** match the local app's shape:
   `<output>/reports/brain_volumes_*.xlsx`, `example_segmentation.mgz`,
   `qc/<subject>_color.png`, `runs/<id>/fastsurfer/…`. Confirm email-on-done if
   an address was given.
5. **Update `docs/STATE.md`** with a dated "HiPerGator validation" entry —
   exactly what ran, the real account/partition/QoS/image path, GPU type, and
   wall-clock for one scan. Correct any stale assumptions you found in step 0.
6. **Only then** consider the OOD app (`deploy/ood/`) for the no-SSH institutional
   form, and the bigger idea below.

## The high-leverage idea for after validation

The HPC paths currently produce **files in a folder with no review experience** —
the entire value layer (the viewer you polished locally) isn't connected. The
bridge worth building is a **"review mode"** for the existing React/FastAPI app:
point it at an existing results folder and render the report/viewer **without
running anything**. That single feature:

- lets a user review HPC results in the real UI (locally on a downloaded folder,
  or via a CPU-only OOD interactive session — no GPU held),
- unifies local and HPC into one experience,
- is the thing that turns "an sbatch wrapper" into "a product UF would pay for."

Don't start it until steps 1–5 are green. Note it in `docs/NEXT_STEPS.md` if it
isn't already.

## Honest caveats

- **Login node ≠ GPU node.** Never run FastSurfer on the login node; use `srun`/a
  batch job. `torch.cuda.is_available()` is `False` on login nodes by design.
- **`--nv` is mandatory** for the container to see the GPU.
- **First run is slow / may surface path + permission issues** (bind mounts,
  `$TMPDIR`, output dir creation under `/blue`). Treat the first green run as the
  milestone, not the speed.
- **Verify, don't trust, the scaffolding's account/partition/image values.** They
  were written from assumptions, not from a successful run.

## Verification commands (from the local app, for reference)

```bash
npm --prefix frontend test
npm --prefix frontend run build
conda run -n vol-analysis python -m unittest discover -s tests -p "test_*.py"
```

(On HiPerGator the relevant "tests" are the smoke-test + one real submission
above, not these — but the backend unit tests still run inside the container.)
