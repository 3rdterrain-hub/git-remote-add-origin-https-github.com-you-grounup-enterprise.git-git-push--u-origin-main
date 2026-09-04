#!/usr/bin/env bash
#
# Put the project's Node toolchain on PATH.
#
# This build runs on a Node installed under ~/.grounup-tools rather than one
# from Homebrew or a system package, and nothing put it on anybody's PATH. The
# result is that every script here worked when run by tooling that knew where
# to look, and failed with "command not found: npm" for the person whose
# machine it is — which is a bad way to find out.
#
# Sourced by the other scripts, so they work regardless of shell setup:
#   source "$(dirname "$0")/node-path.sh"
#
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.grounup-tools/node-*/bin /opt/homebrew/bin /usr/local/bin; do
    if [[ -x "$candidate/node" ]]; then
      PATH="$candidate:$PATH"
      export PATH
      break
    fi
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node could not be found." >&2
  echo "Looked in ~/.grounup-tools, /opt/homebrew/bin and /usr/local/bin." >&2
  echo "Install Node 20 or newer, or run ./scripts/setup-shell.sh" >&2
  return 1 2>/dev/null || exit 1
fi
