#!/bin/bash
#SBATCH --job-name=brain-volume-analysis
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --gres=gpu:1
#SBATCH --account=pinaki.sarder
#SBATCH --partition=hpg-turin
#SBATCH --cpus-per-task=4
#SBATCH --mem=32G
#SBATCH --time=24:00:00
#
# Non-interactive Slurm batch script. Runs the brain volume analysis container.
#
# The #SBATCH lines above are defaults for running this file directly
# (`sbatch job.sh`). submit_job.sh overrides the resource and email flags on the
# sbatch command line, which takes precedence over these directives.
#
# Inputs are read from the environment (set by `sbatch --export`):
#   INPUT_DIR        required  folder of .nii / .nii.gz scans on HiPerGator
#   OUTPUT_DIR       required  folder for reports and QC output (created if missing)
#   RECURSIVE        optional  "true" to search subfolders (default "false")
#   APPTAINER_IMAGE  optional  path to the .sif image (default below)

set -euo pipefail

module load apptainer

image="${APPTAINER_IMAGE:-/blue/pinaki.sarder/kirill.luka/containers/volumetric-analysis_cuda-v2.4.2.sif}"
input_dir="${INPUT_DIR:-}"
output_dir="${OUTPUT_DIR:-}"
recursive="${RECURSIVE:-false}"

if [[ ! -f "$image" ]]; then
  echo "Apptainer image not found: $image" >&2
  exit 1
fi

if [[ -z "$input_dir" || ! -d "$input_dir" ]]; then
  echo "Input folder does not exist: $input_dir" >&2
  exit 1
fi

if [[ -z "$output_dir" ]]; then
  echo "Output folder is required." >&2
  exit 1
fi

mkdir -p "$output_dir"

bind_args=()
for path in /blue /orange /scratch /ufrc "${TMPDIR:-}"; do
  if [[ -n "${path:-}" && -d "$path" ]]; then
    bind_args+=(--bind "$path")
  fi
done

echo "Starting brain volume analysis"
echo "Input folder: $input_dir"
echo "Output folder: $output_dir"
echo "Recursive: $recursive"

apptainer exec --nv "${bind_args[@]}" "$image" \
  python -m volumetric_analysis.run \
  input_dir="$input_dir" \
  output_dir="$output_dir" \
  recursive="$recursive" \
  fastsurfer.install_if_missing=false \
  fastsurfer.executable=/fastsurfer/run_fastsurfer.sh \
  fastsurfer.device=cuda

echo "Brain volume analysis finished"
