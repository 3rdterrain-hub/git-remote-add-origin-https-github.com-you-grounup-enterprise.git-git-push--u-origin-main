#!/bin/sh
# Node is installed under the user's home rather than system-wide (no sudo was
# available on the build machine), so the dev server is launched through this
# wrapper to put it on PATH. npm's own shebang is `#!/usr/bin/env node`, which
# is why pointing launch.json straight at the npm binary is not enough.
NODE_BIN="$HOME/.grounup-tools/node-v24.20.0-darwin-x64/bin"
if [ -d "$NODE_BIN" ]; then
  PATH="$NODE_BIN:$PATH"
  export PATH
fi
cd "$(dirname "$0")/.." || exit 1
exec npm run dev -w @grounup/web -- "$@"
