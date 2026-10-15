#!/usr/bin/env bash
# Append-only docs (ledger, ideas, questions) must merge without conflicts when two branches both append.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T" && git init -q && git config user.email t@t && git config user.name t
cp "$ROOT/.gitattributes" . 2>/dev/null || true
mkdir docs && for f in LEDGER IDEAS QUESTIONS; do echo "# $f" > docs/$f.md; done
git add -A && git commit -qm base && git branch -M a && git branch b
for f in LEDGER IDEAS QUESTIONS; do echo "line from A" >> docs/$f.md; done; git commit -qam a
git checkout -q b; for f in LEDGER IDEAS QUESTIONS; do echo "line from B" >> docs/$f.md; done; git commit -qam b
git checkout -q a
git merge -q --no-edit b >/dev/null
grep -q 'line from A' docs/LEDGER.md && grep -q 'line from B' docs/LEDGER.md
grep -q 'line from A' docs/IDEAS.md && grep -q 'line from B' docs/IDEAS.md
! grep -q '<<<<<<<' docs/LEDGER.md docs/IDEAS.md docs/QUESTIONS.md
