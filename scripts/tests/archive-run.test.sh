#!/usr/bin/env bash
# archive-run.sh: preview by default; with --yes moves origin integration + task/* under archive/<label>/ and
# deletes the originals; never touches main or other branches; never forces.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $1"; exit 1; }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
O="$T/origin.git"; git init -q --bare "$O" && git init -q "$T/w" && cd "$T/w" && git remote add origin "$O"
echo x > f && git add f && git commit -qm init && git branch -M main
git checkout -qb integration && echo i >> f && git commit -qam i
git checkout -qb task/1-a && echo a >> f && git commit -qam a
git checkout -qb dryrun/e2e main && git push -q origin main integration task/1-a dryrun/e2e
INT=$(git rev-parse integration); TA=$(git rev-parse task/1-a)
refs() { git --git-dir="$O" for-each-ref --format='%(refname:short)' | sort | tr '\n' ' '; }
before=$(refs)
bash "$ROOT/scripts/archive-run.sh" dry1 > out.txt 2>&1 || fail "preview must exit 0"
grep -q 'integration' out.txt && grep -q 'task/1-a' out.txt || fail "preview must list branches"
[ "$(refs)" = "$before" ] || fail "preview must not change origin"
bash "$ROOT/scripts/archive-run.sh" dry1 --yes > out.txt 2>&1 || fail "--yes must exit 0"
[ "$(git --git-dir="$O" rev-parse archive/dry1/integration)" = "$INT" ] || fail "integration not archived at same sha"
[ "$(git --git-dir="$O" rev-parse archive/dry1/task/1-a)" = "$TA" ] || fail "task not archived at same sha"
git --git-dir="$O" rev-parse -q --verify refs/heads/integration >/dev/null && fail "integration still on origin"
git --git-dir="$O" rev-parse -q --verify refs/heads/task/1-a >/dev/null && fail "task still on origin"
git --git-dir="$O" rev-parse -q --verify refs/heads/main >/dev/null || fail "main must stay"
git --git-dir="$O" rev-parse -q --verify refs/heads/dryrun/e2e >/dev/null || fail "other branches must stay"
bash "$ROOT/scripts/archive-run.sh" dry1 --yes > out.txt 2>&1 || fail "second run must exit 0"
grep -qi 'nothing to archive' out.txt || fail "second run must say nothing to archive"
# a label already used must be refused, nothing moved
git push -q origin main:refs/heads/integration
bash "$ROOT/scripts/archive-run.sh" dry1 --yes > out.txt 2>&1 && fail "reused label must exit non-zero"
grep -qi 'already used' out.txt || fail "reused label must say so"
git --git-dir="$O" rev-parse -q --verify refs/heads/integration >/dev/null || fail "reused label must not delete anything"
# a --single-branch clone must still see the run's branches
git clone -q --single-branch --branch main "$O" "$T/single" && cd "$T/single"
bash "$ROOT/scripts/archive-run.sh" dry2 > out.txt 2>&1; grep -q 'integration' out.txt || fail "single-branch clone must see integration"
exit 0
