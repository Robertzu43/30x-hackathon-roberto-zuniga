#!/usr/bin/env bash
# PostToolUse(Edit|Write): lint the touched file. Errors go back to the agent via stderr + exit 2
# (exit 0 output never reaches the model). Silent until the project has eslint installed and configured.
# Resolves the git toplevel of the file itself, so it works inside task worktrees.
FILE=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx)
    ls "$ROOT"/eslint.config.* >/dev/null 2>&1 && [ -x "$ROOT/node_modules/.bin/eslint" ] || exit 0
    OUT=$(cd "$ROOT" && node_modules/.bin/eslint --no-warn-ignored "$FILE" 2>&1) ;;
  *.py)
    command -v ruff >/dev/null || exit 0
    OUT=$(ruff check "$FILE" 2>&1) ;;
  *) exit 0 ;;
esac && exit 0
echo "$OUT" | tail -30 >&2
exit 2
