#!/usr/bin/env bash
# Refuse to stop if the current task branch has commits but no ledger entry.
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
case "$BRANCH" in task/*) ;; *) exit 0 ;; esac
grep -q "$BRANCH" docs/LEDGER.md 2>/dev/null && exit 0
echo '{"decision":"block","reason":"No docs/LEDGER.md entry for '"$BRANCH"'. Write the task report before stopping."}'
