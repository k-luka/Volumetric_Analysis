#!/usr/bin/env bash
#
# Laptop launcher for the brain volume analysis tool.
#
# This is the ONE command a doctor runs on their own computer. It:
#   1. Logs into HiPerGator over SSH (you approve the Duo push on your phone).
#   2. Starts the submit wizard there, which asks which folder your scans are in.
#   3. Submits the analysis job and shows you the job ID.
#
# You never have to remember ssh, cd, or sbatch. Run this and answer the questions.
#
# Requirements:
#   - A HiPerGator (UFRC) account with Duo enrolled. Use YOUR OWN GatorLink
#     username; do not share someone else's account.
#   - Your scans already copied to a HiPerGator folder under /blue (or /orange).
#   - An SSH client. macOS and Linux have one built in; Windows 10+ does too.
#
# Usage:
#   bash connect.sh            # connect and run the wizard
#   bash connect.sh --dry-run  # show the ssh command without connecting
#   bash connect.sh --help

set -euo pipefail

# --- settings (edit these if the deployment moves) ------------------------
REMOTE_HOST="hpg.ufl.edu"
REMOTE_DIR="/blue/pinaki.sarder/kirill.luka/Volumetric_Analysis/deploy/wizard"
DEFAULT_USER=""   # optional: set your GatorLink here to skip the username prompt

DRY_RUN=false

usage() {
  cat <<'EOF'
Connect to HiPerGator and submit a brain volume analysis job.

Options:
  --dry-run   Show the ssh command that would run, but do not connect.
  --help      Show this help and exit.

Run with no options to log in and be guided through the prompts.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

echo "============================================"
echo " Brain Volume Analysis - connect & submit"
echo "============================================"
echo
echo "This logs you into HiPerGator and starts the submit wizard there."
echo "When prompted, type your password, then approve the Duo push on your phone."
echo

# Ask for the GatorLink username (default to DEFAULT_USER if set).
if [[ -n "$DEFAULT_USER" ]]; then
  read -rp "HiPerGator username [$DEFAULT_USER]: " REMOTE_USER
  REMOTE_USER="${REMOTE_USER:-$DEFAULT_USER}"
else
  while true; do
    read -rp "Your HiPerGator (GatorLink) username: " REMOTE_USER
    [[ -n "$REMOTE_USER" ]] && break
    echo "A username is required." >&2
  done
fi

# Run the wizard on HiPerGator over an interactive SSH session.
#   -t  : allocate a terminal so the wizard's prompts work over SSH.
remote_cmd="bash '$REMOTE_DIR/submit_job.sh'"
ssh_cmd=(ssh -t "${REMOTE_USER}@${REMOTE_HOST}" "$remote_cmd")

if [[ "$DRY_RUN" == true ]]; then
  echo
  echo "[dry-run] Would run:"
  printf '  '; printf '%q ' "${ssh_cmd[@]}"; echo
  echo
  echo "[dry-run] Nothing was connected."
  exit 0
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "No ssh command found on this computer. Install an SSH client and try again." >&2
  exit 1
fi

echo "Connecting to ${REMOTE_HOST} as ${REMOTE_USER}..."
echo

if ! "${ssh_cmd[@]}"; then
  echo >&2
  echo "The session ended with an error." >&2
  echo "Common causes:" >&2
  echo "  - Wrong username, password, or Duo not approved." >&2
  echo "  - The analysis tool is not installed on HiPerGator at:" >&2
  echo "      $REMOTE_DIR" >&2
  echo "  - You cancelled the wizard (that's fine - no job was submitted)." >&2
  exit 1
fi
