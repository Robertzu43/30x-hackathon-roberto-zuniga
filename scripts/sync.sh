#!/usr/bin/env bash
# Commit the ledger-family docs on the current branch, then push main, integration and task/* to origin.
# Never forces: a rejected push (remote diverged) is reported by name and the run continues. Always exits 0.
cd "$(git rev-parse --show-toplevel)" || exit 0
files=$(ls docs/LEDGER.md docs/QUESTIONS.md docs/IDEAS.md docs/SPEC.md docs/PLAN.md 2>/dev/null)
committed=no
[ -n "$files" ] && git add -- $files && ! git diff --cached --quiet -- $files \
  && git commit -q -m "ledger: sync $(date -u +%Y-%m-%dT%H:%MZ)" -- $files && committed=yes
pushed=0; failed=""
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/main refs/heads/integration refs/heads/task); do
  if git push -q -u origin "$b" >/dev/null 2>&1; then pushed=$((pushed+1)); else failed="$failed $b"; fi
done
echo "sync: committed $committed, pushed $pushed, failed ${failed:+${failed# }}${failed:-none}"
exit 0
