#!/usr/bin/env bash
# Commit the ledger-family docs on the current branch, then push main and this run's branches (<RUN>/integration,
# <RUN>/task/*; RUN comes from the `RUN:` line of docs/CONTEXT.md) to origin. Other runs' branches are never touched.
# Never forces: a rejected push (remote diverged) is reported by name and the run continues. Always exits 0.
# The ledger commit is gated by the secret scan only, not the product test suite: a docs-only commit cannot break
# tests, and durability must not depend on the suite being green at heartbeat time.
SCAN="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/secret-scan.sh"
cd "$(git rev-parse --show-toplevel)" || exit 0
files=$(ls docs/LEDGER.md docs/QUESTIONS.md docs/IDEAS.md docs/SPEC.md docs/PLAN.md 2>/dev/null)
committed=no
[ -n "$files" ] && git add -- $files && ! git diff --cached --quiet -- $files \
  && bash "$SCAN" && git commit -q --no-verify -m "ledger: sync $(date -u +%Y-%m-%dT%H:%MZ)" -- $files && committed=yes
pushed=0; failed=""
RUN=$(sed -n 's/^RUN: *\([A-Za-z0-9._-]*\).*/\1/p' docs/CONTEXT.md 2>/dev/null | head -1)
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/main ${RUN:+refs/heads/$RUN}); do
  if git push -q -u origin "$b" >/dev/null 2>&1; then pushed=$((pushed+1)); else failed="${failed:+$failed }$b"; fi
done
echo "sync: committed $committed, pushed $pushed, failed ${failed:-none}"
exit 0
