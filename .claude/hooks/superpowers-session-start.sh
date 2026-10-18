#!/usr/bin/env bash
# SessionStart: inject using-superpowers so every session (cloud or local) starts with the skills discipline.
# Mirrors the superpowers plugin hook; reads the vendored copy in .claude/skills (kept on branch archive-full-main).
cd "$(dirname "$0")/../.." || exit 0
[ -f .claude/skills/using-superpowers/SKILL.md ] || exit 0  # skills live on the archive-full-main branch
jq -Rs '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:("<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your using-superpowers skill. For all other skills, use the Skill tool:**\n\n"+.+"\n</EXTREMELY_IMPORTANT>")}}' .claude/skills/using-superpowers/SKILL.md
