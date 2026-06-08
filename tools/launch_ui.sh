#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_NAME="${VOL_ANALYSIS_CONDA_ENV:-vol-analysis}"

if ! command -v conda >/dev/null 2>&1; then
  echo "conda was not found. Activate ${ENV_NAME}, then run:" >&2
  echo "  python -m volumetric_analysis.web --build --open" >&2
  exit 127
fi

exec conda run --no-capture-output -n "${ENV_NAME}" python -m volumetric_analysis.web --build --open "$@"
