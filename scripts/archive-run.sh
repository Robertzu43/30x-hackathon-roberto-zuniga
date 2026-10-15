#!/usr/bin/env bash
# Clear a finished run's branches off origin so the next fresh run cannot pick them up (the launcher checks out
# origin/integration when it exists). Usage: scripts/archive-run.sh <label> [--yes]
# Without --yes: preview only. With --yes: push each origin integration and task/* branch to
# archive/<label>/<name> (same commit), then delete the original. Never forces; main and other branches stay.
# Deleting branches is a CLAUDE.md hard stop: only Roberto runs this with --yes.
set -u
LABEL="${1:?usage: scripts/archive-run.sh <label> [--yes]}"; YES="${2:-}"
# explicit refspec: a --single-branch clone would otherwise not see integration/task/*
git fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*' || { echo "archive-run: fetch failed"; exit 1; }
branches=$(git for-each-ref --format='%(refname:short)' refs/remotes/origin/integration refs/remotes/origin/task | sed 's#^origin/##')
[ -z "$branches" ] && { echo "archive-run: nothing to archive"; exit 0; }
git ls-remote --exit-code origin "refs/heads/archive/$LABEL/*" >/dev/null 2>&1 \
  && { echo "archive-run: label '$LABEL' already used on origin; pick another"; exit 1; }
for b in $branches; do echo "archive-run: origin/$b -> archive/$LABEL/$b"; done
[ "$YES" = "--yes" ] || { echo "archive-run: preview only; re-run with --yes to move them"; exit 0; }
fails=0
for b in $branches; do
  git push -q origin "refs/remotes/origin/$b:refs/heads/archive/$LABEL/$b" \
    && git push -q origin --delete "$b" && echo "archived $b" || { echo "FAILED $b"; fails=$((fails+1)); }
done
exit $fails
