#!/usr/bin/env bash
#
# Put this build's Node on your PATH permanently.
#
# Appends one line to your shell profile. It changes nothing else, and it says
# exactly what it added and where, because a script that edits a dotfile
# silently is a script you cannot undo.
#
set -euo pipefail

TOOLCHAIN="$(ls -d "$HOME"/.grounup-tools/node-*/bin 2>/dev/null | head -1 || true)"
if [[ -z "$TOOLCHAIN" ]]; then
  echo "No toolchain found under ~/.grounup-tools." >&2
  echo "If Node is already installed and working, you do not need this." >&2
  exit 1
fi

PROFILE="$HOME/.zshrc"
[[ "${SHELL:-}" == *bash* ]] && PROFILE="$HOME/.bash_profile"

LINE="export PATH=\"$TOOLCHAIN:\$PATH\"  # GrounUp toolchain"

if [[ -f "$PROFILE" ]] && grep -qF "$TOOLCHAIN" "$PROFILE"; then
  echo "Already set up in $PROFILE — nothing to do."
  exit 0
fi

printf '\n# Added by GrounUp: the Node this project is built with.\n%s\n' "$LINE" >> "$PROFILE"

echo "Added to $PROFILE:"
echo "  $LINE"
echo
echo "Open a new terminal tab, or run:  source $PROFILE"
echo "Then check it with:  node --version"
echo
echo "To undo, delete those two lines from $PROFILE."
