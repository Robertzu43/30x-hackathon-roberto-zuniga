#!/usr/bin/env bash
# qa-server.sh: writes a 600 .dev.vars only when gitignored, starts the dev server, prints QA_URL; stop kills it
# and removes .dev.vars. wrangler is stubbed with python's http.server.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T=$(mktemp -d); P=$((18000 + RANDOM % 1000))
fail() { echo "FAIL: $1"; bash "$ROOT/scripts/qa-server.sh" stop "$T/wt" >/dev/null 2>&1; rm -rf "$T"; exit 1; }
mkdir -p "$T/bin" "$T/wt" && git init -q "$T/wt"
printf '#!/bin/sh\n[ "$1 $2" = "wrangler dev" ] && exec python3 -m http.server "$4" --bind 127.0.0.1\nexit 1\n' > "$T/bin/npx"; chmod +x "$T/bin/npx"
export PATH="$T/bin:$PATH" SUPABASE_SERVICE_ROLE_KEY=dummy-service-role RESEND_API_KEY=dummy-resend
bash "$ROOT/scripts/qa-server.sh" start "$T/wt" "$P" >/dev/null 2>&1 && fail "must refuse when .dev.vars is not gitignored"
[ -e "$T/wt/.dev.vars" ] && fail "must not write .dev.vars when not gitignored"
printf '.dev.vars\n.wrangler/\n' > "$T/wt/.gitignore"
out=$(bash "$ROOT/scripts/qa-server.sh" start "$T/wt" "$P" 2>&1) || fail "start failed: $out"
echo "$out" | grep -q "QA_URL http://127.0.0.1:$P" || fail "no QA_URL line: $out"
curl -s -o /dev/null "http://127.0.0.1:$P/" || fail "server not reachable"
[ "$(stat -c %a "$T/wt/.dev.vars")" = 600 ] || fail ".dev.vars must be mode 600"
grep -q '^SUPABASE_SERVICE_ROLE_KEY=dummy-service-role$' "$T/wt/.dev.vars" || fail ".dev.vars missing a secret"
echo "$out" | grep -q 'dummy-' && fail "start must not print secret values"
bash "$ROOT/scripts/qa-server.sh" stop "$T/wt" >/dev/null 2>&1 || fail "stop failed"
curl -s -o /dev/null -m 2 "http://127.0.0.1:$P/" && fail "server still running after stop"
[ -e "$T/wt/.dev.vars" ] && fail ".dev.vars not removed by stop"
rm -rf "$T"; exit 0
