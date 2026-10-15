#!/usr/bin/env bash
# Commits made through the repo's real pre-commit hook: a pathspec commit (what sync.sh and agents do) must pass,
# sync.sh must commit the ledger even when the product suite is red, and must still refuse a secret.
# Copies only sync.test.sh into the temp repo, never this file, so the hook cannot recurse.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $1"; exit 1; }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q --bare "$T/origin.git" && git init -q "$T/w" && cd "$T/w" && git remote add origin "$T/origin.git"
mkdir -p .githooks .claude/hooks scripts/tests docs
cp "$ROOT/.githooks/pre-commit" .githooks/ && cp "$ROOT/.claude/hooks/secret-scan.sh" .claude/hooks/
cp "$ROOT/scripts/sync.sh" scripts/ && cp "$ROOT/scripts/tests/run.sh" "$ROOT/scripts/tests/sync.test.sh" scripts/tests/
echo "# Ledger" > docs/LEDGER.md && git add -A && git commit -q --no-verify -m init && git branch -M main && git push -q origin main
git config core.hooksPath .githooks
echo "- pathspec entry" >> docs/LEDGER.md
git commit -q -m pathspec -- docs/LEDGER.md >/dev/null 2>&1 || fail "pathspec commit through the hook was blocked"
echo '{"scripts":{"test":"exit 1"}}' > package.json && git add package.json && git commit -q --no-verify -m red-suite
echo "- heartbeat entry" >> docs/LEDGER.md
bash scripts/sync.sh | tail -1 | grep -q 'committed yes' || fail "sync.sh did not commit the ledger with a red product suite"
git --git-dir="$T/origin.git" show main:docs/LEDGER.md | grep -q 'heartbeat entry' || fail "ledger not pushed"
echo "- leaked AKIA""IOSFODNN7EXAMPLE" >> docs/LEDGER.md
bash scripts/sync.sh | tail -1 | grep -q 'committed no' || fail "sync.sh committed a secret"
exit 0
