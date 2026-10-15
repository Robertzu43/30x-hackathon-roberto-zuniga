#!/usr/bin/env bash
# lint-file.sh: silent without eslint config, exit 2 with errors on stderr when lint fails, works per git toplevel.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
git init -q "$T" && mkdir -p "$T/src" "$T/node_modules/.bin" && echo 'const x = 1' > "$T/src/x.ts" && echo '# r' > "$T/README.md"
printf '#!/bin/sh\necho "1 error: no-unused-vars"\nexit 1\n' > "$T/node_modules/.bin/eslint"; chmod +x "$T/node_modules/.bin/eslint"
run() { echo "{\"tool_input\":{\"file_path\":\"$1\"}}" | bash "$ROOT/.claude/hooks/lint-file.sh" 2>"$T/err" >"$T/out"; }
fail() { echo "FAIL: $1"; exit 1; }
run "$T/src/x.ts"; c=$?; [ $c -eq 0 ] && [ ! -s "$T/err" ] && [ ! -s "$T/out" ] || fail "no config must be silent exit 0 (got $c)"
touch "$T/eslint.config.js"
run "$T/src/x.ts"; c=$?; [ $c -eq 2 ] || fail "lint error must exit 2 (got $c)"
grep -q 'no-unused-vars' "$T/err" || fail "lint output must go to stderr"
run "$T/README.md"; [ $? -eq 0 ] || fail "non-code file must exit 0"
printf '#!/bin/sh\nexit 0\n' > "$T/node_modules/.bin/eslint"
run "$T/src/x.ts"; c=$?; [ $c -eq 0 ] && [ ! -s "$T/err" ] || fail "clean lint must be silent exit 0 (got $c)"
exit 0
