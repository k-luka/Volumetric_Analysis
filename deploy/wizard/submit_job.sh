#!/usr/bin/env bash
#
# Interactive wizard for submitting a brain volume analysis job on HiPerGator.
#
# A doctor opens a terminal (OOD Shell or SSH), runs this script, answers a few
# prompts, and a Slurm job is submitted. The job itself runs job.sh, which lives
# next to this file.
#
# Usage:
#   bash submit_job.sh            # ask the questions and submit
#   bash submit_job.sh --dry-run  # ask the questions, print the command, submit nothing
#   bash submit_job.sh --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB_SCRIPT="$SCRIPT_DIR/job.sh"

DRY_RUN=false

usage() {
  cat <<'EOF'
Submit a brain volume analysis job on HiPerGator.

Options:
  --dry-run   Ask all the questions and print the sbatch command, but do not submit.
  --help      Show this help and exit.

Run with no options to be guided through the prompts and submit the job.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ ! -f "$JOB_SCRIPT" ]]; then
  echo "Cannot find job.sh next to this script (expected $JOB_SCRIPT)." >&2
  exit 1
fi

# --- small helpers --------------------------------------------------------

# Lowercase a string portably (works on bash 3.2 / macOS).
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Expand a leading ~ to $HOME (the shell does not do this for `read` input).
expand_tilde() {
  case "$1" in
    "~")    printf '%s' "$HOME" ;;
    "~/"*)  printf '%s' "$HOME/${1#\~/}" ;;
    *)      printf '%s' "$1" ;;
  esac
}

# Turn a path into an absolute path without requiring it to exist yet.
to_abs() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  printf '%s' "$PWD/$1" ;;
  esac
}

# Prompt for a positive integer with a default (Enter keeps the default).
ask_positive_int() {
  local prompt="$1" default="$2" reply
  while true; do
    read -rp "$prompt [$default]: " reply
    reply="${reply:-$default}"
    if [[ "$reply" =~ ^[1-9][0-9]*$ ]]; then
      printf '%s' "$reply"
      return 0
    fi
    echo "Please enter a whole number of at least 1." >&2
  done
}

# --- intro ----------------------------------------------------------------

echo "========================================"
echo " Brain Volume Analysis - job submitter"
echo "========================================"
echo
echo "Answer a few questions and this will submit the analysis to HiPerGator."
echo "Press Enter to accept the [default] shown for resource questions."
echo

# --- prompts --------------------------------------------------------------

# 1. Input folder (required, must already exist).
while true; do
  read -rp "Input folder with your scans (must already exist): " INPUT_DIR
  INPUT_DIR="$(expand_tilde "$INPUT_DIR")"
  if [[ -z "$INPUT_DIR" ]]; then
    echo "An input folder is required." >&2
    continue
  fi
  if [[ ! -d "$INPUT_DIR" ]]; then
    echo "That folder was not found: $INPUT_DIR" >&2
    continue
  fi
  INPUT_DIR="$(to_abs "$INPUT_DIR")"
  break
done

# 2. Output folder (required, created later if missing).
while true; do
  read -rp "Output folder for the report (created if missing): " OUTPUT_DIR
  OUTPUT_DIR="$(expand_tilde "$OUTPUT_DIR")"
  if [[ -z "$OUTPUT_DIR" ]]; then
    echo "An output folder is required." >&2
    continue
  fi
  OUTPUT_DIR="$(to_abs "$OUTPUT_DIR")"
  break
done

# 3. Search subfolders?
read -rp "Search subfolders for scans too? [y/N]: " reply
case "$(lower "$reply")" in
  y|yes) RECURSIVE=true ;;
  *)     RECURSIVE=false ;;
esac

# Friendly heads-up if the input folder has no scans the analysis can read.
if [[ "$RECURSIVE" == true ]]; then
  scan_count="$(find "$INPUT_DIR" -type f \( -name '*.nii' -o -name '*.nii.gz' \) 2>/dev/null | wc -l | tr -d '[:space:]')"
else
  scan_count="$(find "$INPUT_DIR" -maxdepth 1 -type f \( -name '*.nii' -o -name '*.nii.gz' \) 2>/dev/null | wc -l | tr -d '[:space:]')"
fi
if [[ "${scan_count:-0}" -eq 0 ]]; then
  echo
  echo "Warning: no .nii or .nii.gz files found in that folder." >&2
  echo "The job will still run but the report will be empty. Check the folder if that's not expected." >&2
  echo
else
  echo "Found $scan_count scan file(s) to process."
fi

# 4. Email (optional).
read -rp "Email to notify when the job finishes (optional, Enter to skip): " EMAIL
if [[ -n "$EMAIL" ]]; then
  case "$EMAIL" in
    *@*.*) : ;;
    *) echo "That does not look like an email address; notifications may not arrive." >&2 ;;
  esac
fi

# 5-7. Resources (Enter keeps the default).
HOURS="$(ask_positive_int "Wall time in hours" 24)"
CPUS="$(ask_positive_int "CPU cores" 4)"
MEM="$(ask_positive_int "Memory in GB" 32)"

# --- confirmation summary -------------------------------------------------

echo
echo "Please review:"
echo "  Input folder:      $INPUT_DIR"
echo "  Output folder:     $OUTPUT_DIR"
echo "  Search subfolders: $RECURSIVE"
echo "  Email:             ${EMAIL:-(none)}"
echo "  Wall time:         ${HOURS} hour(s)"
echo "  CPU cores:         $CPUS"
echo "  Memory:            ${MEM} GB"
echo "  Slurm account:     pinaki.sarder"
echo "  Partition:         hpg-turin"
echo "  GPUs:              1"
echo
read -rp "Submit this job? [Y/n]: " confirm
case "$(lower "$confirm")" in
  n|no) echo "Cancelled. No job was submitted."; exit 0 ;;
esac

# --- build the sbatch command --------------------------------------------

# job.sh reads these from the environment; --export=ALL passes them through.
export INPUT_DIR OUTPUT_DIR RECURSIVE

sbatch_cmd=(sbatch --parsable
  --cpus-per-task="$CPUS"
  --mem="${MEM}G"
  --time="${HOURS}:00:00"
  --export=ALL
)
if [[ -n "$EMAIL" ]]; then
  sbatch_cmd+=(--mail-type=END,FAIL --mail-user="$EMAIL")
fi
sbatch_cmd+=("$JOB_SCRIPT")

# --- dry run: show the command and stop ----------------------------------

if [[ "$DRY_RUN" == true ]]; then
  echo
  echo "[dry-run] Would create output folder: $OUTPUT_DIR"
  echo "[dry-run] Would submit:"
  printf '  INPUT_DIR=%q OUTPUT_DIR=%q RECURSIVE=%q \\\n  ' "$INPUT_DIR" "$OUTPUT_DIR" "$RECURSIVE"
  printf '%q ' "${sbatch_cmd[@]}"
  echo
  echo
  echo "[dry-run] Nothing was submitted."
  exit 0
fi

# --- submit ---------------------------------------------------------------

if ! command -v sbatch >/dev/null 2>&1; then
  echo "sbatch was not found. Run this on HiPerGator (OOD Shell or an SSH session)." >&2
  echo "To preview the command without submitting, re-run with --dry-run." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

if ! jobid="$("${sbatch_cmd[@]}")"; then
  echo "sbatch failed to submit the job. See the message above." >&2
  exit 1
fi
jobid="${jobid%%;*}"  # --parsable may print "jobid;cluster"

echo
echo "Submitted job $jobid"
echo
echo "  Output folder: $OUTPUT_DIR"
echo "  Check status:  squeue -j $jobid"
echo "  When done:     $OUTPUT_DIR/reports/"
echo
echo "You can close this terminal - the job runs on the cluster in the background."
if [[ -n "$EMAIL" ]]; then
  echo "Slurm will email $EMAIL when the job finishes or fails."
fi
