#!/usr/bin/env bash
# Pre-commit: block anything that looks like a credential. Repo goes public during review.
PATTERN='(AKIA[0-9A-Z]{16}|re_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|CLOUDFLARE_API_TOKEN=[A-Za-z0-9_-]{20,}|AWS_SECRET_ACCESS_KEY=[A-Za-z0-9/+]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+|AC[a-f0-9]{32}|cfat_[A-Za-z0-9_-]{30,}|R2_SECRET_ACCESS_KEY=[a-f0-9]{40,}|sbp_[A-Za-z0-9]{30,}|SUPABASE_SERVICE_ROLE_KEY=eyJ|SUPABASE_DB_URL=postgres(ql)?://[^:]+:[^@]+@|service_role.{0,40}eyJ[A-Za-z0-9_-]{20,}|TYPESAFE_API_KEY=[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,})'
if git diff --cached -U0 -- . ':!.claude/hooks/secret-scan.sh' | grep -E "^\+" | grep -Eq "$PATTERN"; then  # the scanner's own patterns are not secrets
  echo "BLOCKED: staged diff contains something that looks like a secret. Use wrangler secret put / env vars."
  exit 1
fi
exit 0
