# Product Vision

> Status: long-term vision and strategy. For what exists today see `docs/CURRENT_SPEC.md`.
> For near-term build plans see `docs/SUBMIT_WIZARD_PLAN.md` and `docs/OOD_BATCH_APP_PLAN.md`.

## North Star

A doctor drags in a brain MRI (or a folder of them), clicks **Run**, and a few
minutes later sees per-region brain volumes compared against a normal
population, with a quality-control image they can trust and a one-page PDF —
without ever knowing the words *container*, *Slurm*, or *SSH*.

This is the category of **clinician-facing brain volumetry** — the space of
NeuroQuant, icobrain, Neuroreader, and volBrain. Our segmentation engine
(FastSurfer → DKT regional labels) already produces the raw material. The
product is the **experience and interpretation layer** on top, plus the ability
to run that engine wherever the customer's data and budget allow.

## Who It's For

Researchers and clinicians who need volumes from structural brain MRI — for
studies of aging, dementia (hippocampal atrophy), MS, TBI, and similar.

They sit on a **data-security spectrum** that determines what's even possible:

- Labs that can use a personal machine freely (the easy case).
- Labs whose data must stay on **locked-down, institution-owned Windows
  machines that have no GPU** (a large, important segment — see the Key Tension).
- Institutions with their own HPC (e.g. UF HiPerGator) and an allocation budget.

## What the Perfect Tool Does

1. **Import** — drag a folder of DICOM or NIfTI scans. Auto-convert DICOM→NIfTI
   and de-identify. Report what was found ("12 T1 scans, 3 subjects").
2. **Choose where to run** — one toggle: *This computer* or *Institution / cloud*.
   The app recommends based on batch size and available hardware.
3. **Run** — real progress, per-scan status, queue position if remote. Survives a
   closed laptop; notifies on completion.
4. **Review** — sortable volume table; a **scrollable QC viewer** (segmentation
   overlaid on the MRI); outliers and failures flagged.
5. **Interpret** — each region as a **normative percentile** ("hippocampus: 3rd
   percentile for age/sex"). Longitudinal tracking for repeat scans.
6. **Export** — one-page **PDF report** + Excel, with method and model version
   recorded for citation and reproducibility.

The leap from "a number" to "clinically meaningful" is the **normative
comparison** — and the reference dataset behind it is the real moat.

## Three Ways to Run

The same analysis engine (one container image) runs in three places. "Where" is
a routing decision; results are identical by construction.

| Model | Where it runs | Best for | Licensing |
|---|---|---|---|
| **Local / desktop** | the user's own machine (CPU, or GPU/Apple MPS) | individual researchers, sensitive data that must not move, small batches | per-seat key, or a seat bundle |
| **Institutional HPC** | university cluster (HiPerGator) as an Open OnDemand app | institutions with HPC and many users, large batches | site / department license |
| **Cloud (SaaS)** | our GPUs in the cloud | secure labs with no GPU and no HPC; pay-as-you-go | usage-based metering |

Customer situation maps cleanly onto a tier: own a capable machine → desktop;
own a cluster → HPC site license; own neither but need scale/speed → cloud.

## The Key Tension: Secure Windows, No GPU

Many target labs keep data only on institution-owned **Windows machines without
GPUs**. For them:

- **Local won't really work.** FastSurfer runs on CPU but slowly; a 50-scan batch
  is impractical, and Windows GPU support adds friction.
- This is why **remote is not optional long-term.** The secure-no-GPU segment is
  precisely the case that pushes toward HPC or cloud execution.

Strategic consequence: **don't gold-plate the local version for Windows/GPU.**
Use local where it shines (capable machines, privacy, demos) and serve the
secure-no-GPU segment with the HPC and cloud paths.

## Architecture: One Engine, Many Backends

```
            +---------------- UI (desktop app) ----------------+
            |  import - choose backend - monitor - review/export |
            +---------------------------+------------------------+
                       shared job / orchestration core
            +---------------------------+------------------------+
      Local backend            HPC backend (HiPerGator)     Cloud backend
   same container, CPU/        same container on Slurm,     same container on
   GPU/MPS; data stays         L4 GPU; scales to batches    our managed GPUs;
   on the machine                                           usage-metered
```

- **Same container image everywhere** → reproducible; "where" is just routing.
- **Thin client.** The local app and the HPC launcher do orchestration
  (auth, transfer, submit, fetch, cleanup), not computing.
- **Distribution without Globus.** Publish the image to a registry once; HPC
  pulls it directly (`apptainer build … docker://…`). Stage it once per lab
  allocation so new users do zero setup. Local downloads and caches it on first
  run. The user's laptop is never in the multi-GB data path.

## Business Model

- **Desktop:** per-seat license key, or a discounted seat bundle for a lab.
- **Institutional HPC:** annual site/department license; deployed as the OOD app.
- **Cloud:** usage-based (per scan or per GPU-minute), for labs without HPC.

Cross-cutting needs: license-key issuance/validation, versioned updates,
support, and clear documentation. Keep enforcement light early; correctness and
trust matter more than tight DRM for a research tool.

## Hard Problems & Honest Constraints

- **Regulatory.** The moment volumes drive diagnosis, this is near medical-device
  territory (FDA/CE) — which is why the comparables are *cleared* products. A
  perfect **research-use** tool is very achievable; a **clinical** tool carries a
  compliance burden. Be explicit about research-use-only vs clinical.
- **Normative data.** Percentiles need a healthy reference dataset (licensed or
  self-built). This is the hardest non-engineering piece and the main moat.
- **PHI / privacy.** DICOM import, de-identification, and (for cloud) a secure,
  auditable pipeline. Local mode is the "data never leaves the building" answer.
- **Accounts.** HPC mode needs institution accounts + 2FA; local and cloud are
  the escape hatches for users who will never have one.

## Roadmap

Phases are ordered by dependency and value, not strictly sequential — long-lead
external items (UFRC approval) start early and run in parallel.

- **Phase 1 — Local CLI MVP (now).** Package the existing pipeline into a clean,
  installable CLI with the interactive wizard. Purpose: prove the pipeline end to
  end and **lock the science with the doctor** (volume definition, regions, report
  format — the real bottleneck; see `docs/CURRENT_SPEC.md`). Runs great on Apple/MPS
  for demos. In practice the shipped MVP deliverable today is the local React/FastAPI
  web UI (`./tools/launch_ui.sh`) over that same engine; the CLI and wizard remain as
  scripted/terminal entry points.
- **Phase 1b — Email UFRC (now, in parallel).** Ask whether the OOD app can be
  enabled. Long latency, near-zero cost to start; do not wait for Phase 1 to
  finish.
- **Phase 2 — Manual-image HPC CLI (while waiting).** Stage the `.sif` on
  HiPerGator once; the launcher + submit wizard handle auth, submit, fetch,
  cleanup. Bridges the gap before OOD and serves the secure-no-GPU segment via
  remote GPU. (Building blocks already scaffolded in `deploy/wizard/`.)
- **Phase 3 — OOD app (if UFRC approves).** The polished institutional
  deployment; site-license path.
- **Phase 4 — Desktop UI.** Wrap the engine in a real UI with local + remote
  backends and the review/interpret experience.
- **Phase 5 — Cloud SaaS.** Secure, usage-metered cloud GPUs for labs without
  HPC. Highest build cost (security, billing); on the backburner until demand and
  the security model are clear.
- **Cross-cutting value layer.** Normative percentiles, PDF reports, DICOM
  import, longitudinal tracking — layered in once the science is locked.

## Open Strategic Questions

- Research-use-only, or a path toward clinical clearance?
- Where does the normative reference dataset come from?
- Do the target labs have HPC access, or is cloud the only viable scale path?
- Is the first paying customer an institution (site license) or individuals
  (seats)? This reorders Phases 3–5.
