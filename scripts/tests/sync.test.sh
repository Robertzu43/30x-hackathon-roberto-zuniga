#!/usr/bin/env bash
# sync.sh commits the ledger, pushes main/integration/task branches, never forces, and reports rejected pushes.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
g(){ git -c user.email=t@t -c user.name=t "$@"; }
git init -q --bare "$T/origin.git"
git init -q "$T/w" && cd "$T/w" && git remote add origin "$T/origin.git"
mkdir docs && echo "# Ledger" > docs/LEDGER.md && echo "RUN: r1" > docs/CONTEXT.md && g add -A && g commit -qm init && git branch -M main && git push -q origin main
git checkout -qb r1/task/01-a && echo a > a && g add a && g commit -qm a
git branch task/9-old main
git checkout -qb r1/task/02-b main && echo local > b && g add b && g commit -qm local-b
# someone else pushed a different task/02-b: our push must be rejected, not forced
git clone -q "$T/origin.git" "$T/other" && cd "$T/other" && git checkout -qb r1/task/02-b && echo remote > b && g add b && g commit -qm remote-b && git push -q origin r1/task/02-b
REMOTE_02B=$(git rev-parse HEAD)
cd "$T/w" && git checkout -qb r1/integration main && echo "task/01-a done" >> docs/LEDGER.md
out=$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t bash "$ROOT/scripts/sync.sh")
O="$T/origin.git"
git --git-dir="$O" rev-parse -q --verify refs/heads/r1/integration >/dev/null
git --git-dir="$O" rev-parse -q --verify refs/heads/r1/task/01-a >/dev/null
! git --git-dir="$O" rev-parse -q --verify refs/heads/task/9-old >/dev/null  # other runs' branches are never pushed
git --git-dir="$O" show r1/integration:docs/LEDGER.md | grep -q 'task/01-a done'
test "$(echo "$out" | tail -1)" = "sync: committed yes, pushed 3, failed r1/task/02-b"
test "$(git --git-dir="$O" rev-parse r1/task/02-b)" = "$REMOTE_02B"
