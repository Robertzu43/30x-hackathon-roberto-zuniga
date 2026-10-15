#!/usr/bin/env bash
# Setup script for the claude.ai/code cloud environment (Environment -> setup script: `bash scripts/cloud-setup.sh`).
# Fresh Linux container every session, so this is idempotent and quick. Credentials come from the environment variables.
set -u
export PATH="$HOME/.local/bin:$PATH"
command -v uv  >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1
command -v aws >/dev/null || curl -fsSL https://awscli.amazonaws.com/v2/install.sh | bash >/dev/null 2>&1
command -v jq  >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq jq; } >/dev/null 2>&1 || true
npx -y playwright install chromium --with-deps >/dev/null 2>&1 || npx -y playwright install chromium >/dev/null 2>&1
[ -n "${AWS_PROFILE_NAME:-}" ] && aws configure set region "${AWS_REGION:-us-east-2}" --profile "$AWS_PROFILE_NAME" 2>/dev/null
git config core.hooksPath .githooks
echo "cloud setup: uv=$(command -v uv >/dev/null && echo ok || echo missing) aws=$(aws --version 2>/dev/null | cut -d' ' -f1 || echo missing) playwright=$(npx -y playwright --version 2>/dev/null || echo missing)"
echo "AWS needs one phone sign-in per cloud session: aws login --profile ${AWS_PROFILE_NAME:-30x} --remote"
