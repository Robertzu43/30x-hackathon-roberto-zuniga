#!/usr/bin/env bash
[ -f .env ] && { set -a; . ./.env; set +a; }  # local laptop: load .env (gitignored); cloud session: env config instead
# Push session-env secrets to the deployed Worker (run after the first `wrangler deploy`). Never echoes values.
fails=0
for n in RESEND_API_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_POOLER_URL TYPESAFE_API_KEY ANTHROPIC_API_KEY; do
  [ -n "${!n:-}" ] || continue
  if printf %s "${!n}" | npx -y wrangler secret put "$n" >/dev/null 2>&1; then echo "secret $n: ok"; else echo "secret $n: failed"; fails=$((fails+1)); fi
done
exit $fails
