#!/usr/bin/env bash

set -euo pipefail

# dTRINITY dSTAKE context bundler
# - Collects all dSTAKE contracts and design docs into one text blob
# - Copies the result to macOS clipboard (pbcopy) by default
# - Optionally prints to stdout with --stdout

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DSTAKE_DIR="$REPO_ROOT/contracts/vaults/dstake"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--stdout]

Description:
  Bundle all dSTAKE-related Solidity contracts and design docs into a single
  text output suitable for LLM context. By default, the output is copied to the
  macOS clipboard via pbcopy. Use --stdout to print to terminal instead.

Includes files under:
  $DSTAKE_DIR

Options:
  --stdout   Print to stdout instead of copying to clipboard
  -h, --help Show this help and exit
EOF
}

MODE="clipboard"
if [[ ${1:-} == "--stdout" ]]; then
  MODE="stdout"
elif [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$DSTAKE_DIR" ]]; then
  echo "Error: dSTAKE directory not found at $DSTAKE_DIR" >&2
  exit 1
fi

# Gather files: Solidity and Markdown (portable for macOS Bash 3.2)
FILES=()
while IFS= read -r line; do
  FILES+=("$line")
done < <(find "$DSTAKE_DIR" -type f \( -name "*.sol" -o -name "*.md" \) | LC_ALL=C sort)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Error: No dSTAKE files found in $DSTAKE_DIR" >&2
  exit 1
fi

TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT

# Metadata header
{
  echo "dTRINITY dSTAKE Context Bundle"
  echo "Generated: $(date -u +"%Y-%m-%d %H:%M:%S") UTC"
  if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "Repo: $(basename "$REPO_ROOT")"
    echo "Branch: $BRANCH"
    echo "Commit: $COMMIT"
  fi
  echo "Root: $REPO_ROOT"
  echo "Source Dir: $DSTAKE_DIR"
  echo
  echo "Included files (sorted):"
  for f in "${FILES[@]}"; do
    rel="${f#"$REPO_ROOT/"}"
    echo "- $rel"
  done
} >>"$TMPFILE"

# Append each file with clear boundaries
for f in "${FILES[@]}"; do
  rel="${f#"$REPO_ROOT/"}"
  {
    echo
    echo "================================================================================"
    echo "BEGIN FILE: $rel"
    echo "--------------------------------------------------------------------------------"
    cat "$f"
    echo
    echo "--------------------------------------------------------------------------------"
    echo "END FILE: $rel"
    echo "================================================================================"
  } >>"$TMPFILE"
done

# Deliver output
if [[ "$MODE" == "stdout" ]]; then
  cat "$TMPFILE"
else
  if command -v pbcopy >/dev/null 2>&1; then
    cat "$TMPFILE" | pbcopy
    BYTES=$(wc -c <"$TMPFILE" | tr -d '[:space:]')
    echo "Copied ${#FILES[@]} files (${BYTES} bytes) to clipboard." >&2
  else
    echo "Warning: pbcopy not found. Printing to stdout instead." >&2
    cat "$TMPFILE"
  fi
fi



