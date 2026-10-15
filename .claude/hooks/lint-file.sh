#!/usr/bin/env bash
# Lint only the touched file. Adjust to the stack chosen in docs/DECISIONS.md.
FILE=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$FILE" ] && exit 0
case "$FILE" in
  *.ts|*.tsx|*.js) npx eslint --no-warn-ignored "$FILE" 2>&1 | tail -20 ;;
  *.py) ruff check "$FILE" 2>&1 | tail -20 ;;
esac
exit 0
