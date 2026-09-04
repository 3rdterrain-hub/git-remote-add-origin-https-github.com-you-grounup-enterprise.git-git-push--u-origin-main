#!/usr/bin/env bash
#
# Connect this build to a Supabase project.
#
# Idempotent: run it again after a failure and it picks up where it stopped.
#
# It never asks for a secret it does not need. The two values written to
# apps/web/.env.local are the project URL and the anon key, both public by
# design — every VITE_ variable is embedded in the browser bundle, and row
# level security is what makes that safe. The database password goes to the
# Supabase CLI and is never stored by this script; a service-role key is never
# asked for at all, and `npm run bundle:check` refuses the build if one ever
# reaches the bundle by name or by shape.
#
#   ./scripts/connect-supabase.sh <project-ref>
#
set -euo pipefail
cd "$(dirname "$0")/.."

RAW="${1:-}"

# Accept whatever the person has to hand rather than one exact form: the
# dashboard URL, the API URL, or the bare ref. Guessing wrong here costs
# somebody ten minutes of hunting through settings pages that get rearranged.
REF="$RAW"
REF="${REF#https://}"
REF="${REF#http://}"
case "$REF" in
  supabase.com/dashboard/project/*) REF="${REF#supabase.com/dashboard/project/}" ;;
  app.supabase.com/project/*)       REF="${REF#app.supabase.com/project/}" ;;
esac
REF="${REF%%/*}"          # drop any trailing path
REF="${REF%%.supabase.co}"
REF="${REF%%.supabase.in}"
REF="${REF%%\?*}"         # drop a query string

if [[ -z "$REF" ]]; then
  cat <<'USAGE'
Usage: ./scripts/connect-supabase.sh <project-ref>

The easiest place to find it is your browser's address bar with the project
open. It is the last part of the dashboard URL:

  https://supabase.com/dashboard/project/abcdefghijklmnopqrst
                                         ^^^^^^^^^^^^^^^^^^^^

You can paste any of these and this script will work out the rest:

  abcdefghijklmnopqrst
  https://abcdefghijklmnopqrst.supabase.co
  https://supabase.com/dashboard/project/abcdefghijklmnopqrst

If you have no project yet, make one at https://supabase.com/dashboard —
any region, and remember the database password it asks you to set.
USAGE
  exit 2
fi

if [[ ! "$REF" =~ ^[a-z0-9]{16,32}$ ]]; then
  echo "\"$RAW\" does not look like a project ref." >&2
  echo "A ref is 20 or so lowercase letters and digits, with no dots or slashes." >&2
  echo "Run this with no arguments to see where to find yours." >&2
  exit 2
fi

echo "Project ref: $REF"

echo "==> 1/4  Linking to $REF"
echo "         The CLI will ask for your database password. Nothing here stores it."
npx supabase link --project-ref "$REF"

echo
echo "==> 2/4  Applying migrations and the master library"
echo "         65 migrations: every table, policy, function and view."
echo "         Then the seed catalog: services, assemblies, production rates,"
echo "         equipment, labor rates and the plan catalog."
npx supabase db push --linked --include-seed

echo
echo "==> 3/4  Writing apps/web/.env.local"
DEFAULT_URL="https://$REF.supabase.co"
read -r -p "         Project URL [$DEFAULT_URL]: " URL
URL="${URL:-$DEFAULT_URL}"
echo "         anon / public key, from Project Settings -> API Keys."
read -r -p "         anon key: " ANON

if [[ -z "$ANON" ]]; then
  echo "         No key given. Nothing written." >&2
  exit 1
fi
if [[ "$ANON" == *"service_role"* || "$ANON" == sb_secret_* ]]; then
  echo "         That looks like a service-role key. It must never reach the" >&2
  echo "         browser. Use the anon / publishable key instead." >&2
  exit 1
fi

cat > apps/web/.env.local <<ENV
# Public by design. Every VITE_ variable is embedded in the browser bundle,
# and row level security is what makes that safe. Never put a service-role
# key or any other secret here — scripts/check-bundle.mjs refuses the build
# if one appears, by name or by shape.
VITE_SUPABASE_URL=$URL
VITE_SUPABASE_ANON_KEY=$ANON
ENV
echo "         Written."

echo
echo "==> 4/4  Verifying the bundle carries no secret"
npm run build >/dev/null 2>&1
npm run bundle:check

cat <<'NEXT'

Connected.

  npm run dev

Then:
  1. Sign up at  /signup
  2. Name your company at  /welcome  (this is what provisions the tenant:
     owner membership, a default pricing profile with overhead, profit and
     contingency, and a bounded trial)
  3. Everything else opens against your own workspace

To make yourself a platform operator — the /admin console — run this once in
the SQL editor, with your own email:

  insert into platform_admins (user_id, reason)
  select id, 'Runs the platform' from auth.users where email = 'you@example.com';

There is deliberately no button for that. It is the most powerful flag in the
system and adding one is a deployment act, not a click.
NEXT
