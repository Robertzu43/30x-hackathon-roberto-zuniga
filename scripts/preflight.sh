#!/usr/bin/env bash
[ -f .env ] && { set -a; . ./.env; set +a; }  # local laptop: load .env (gitignored); cloud session: env config instead
# Proves every credential works before any agent builds. Exit non-zero on any FAIL.
set -u
FAILS=0
ok(){ echo "PASS  $1"; }
bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
need(){ [ -n "${!1:-}" ] || { bad "env $1 is empty"; return 1; }; }
SLUG="${PROJECT_SLUG:-30x-hackathon}"

echo "== Cloudflare"
need CLOUDFLARE_API_TOKEN && need CLOUDFLARE_ACCOUNT_ID && {
  npx -y wrangler whoami >/dev/null 2>&1 && ok "wrangler whoami" || bad "wrangler whoami"
  # wrangler 4 no longer prints token scopes; prove Workers Scripts access with the API call deploy needs
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
  [ "$code" = "200" ] && ok "token can list Workers scripts (deploy scope)" || bad "token cannot access Workers scripts ($code): create one from the Edit Cloudflare Workers template, not an R2 token"
  npx -y wrangler kv namespace list 2>/dev/null | grep -q "$SLUG-kv" || npx -y wrangler kv namespace create "$SLUG-kv" >/dev/null 2>&1
  npx -y wrangler kv namespace list 2>/dev/null | grep -q "$SLUG-kv" && ok "KV $SLUG-kv" || bad "KV $SLUG-kv"
}

echo "== GitHub"
git push --dry-run origin HEAD >/dev/null 2>&1 && ok "git push access to origin" || bad "git push access to origin (cloud: connect GitHub at claude.ai/connect-github; laptop: gh auth login)"
gh auth status >/dev/null 2>&1 && echo "INFO  gh cli authenticated" || echo "INFO  gh cli not authenticated (optional: git push and the GitHub MCP tools are the cloud paths)"

echo "== Supabase"
need SUPABASE_URL && need SUPABASE_ANON_KEY && {
  # /rest/v1/ (OpenAPI root) now demands a secret key; /auth/v1/settings is the public endpoint a publishable/anon key must pass
  code=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/auth/v1/settings" -H "apikey: $SUPABASE_ANON_KEY")
  [ "$code" = "200" ] && ok "anon/publishable key accepted (auth settings)" || bad "anon/publishable key rejected ($code)"
  curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $SUPABASE_ANON_KEY" | grep -q '"mailer_autoconfirm":true' \
    || echo "WARN  Confirm email is on: QA cannot sign up users (INFRA.md Supabase step 4)"
}
need SUPABASE_SERVICE_ROLE_KEY && {
  code=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/auth/v1/admin/users?per_page=1"     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  [ "$code" = "200" ] && ok "service_role admin access" || bad "service_role admin access ($code)"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/storage/v1/bucket/files" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  [ "$code" = "200" ] || echo "WARN  storage bucket 'files' missing: bash scripts/db-push.sh"
}
need SUPABASE_ACCESS_TOKEN && need SUPABASE_PROJECT_REF && {
  code=$(curl -s -o /tmp/sb-mgmt.json -w "%{http_code}" -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"query":"select 1 as ok"}')
  { [ "$code" = 200 ] || [ "$code" = 201 ]; } && ok "management api sql over https (migrations: scripts/db-push.sh)" || bad "management api sql ($code): $(head -c 120 /tmp/sb-mgmt.json)"
  [ -d supabase ] || npx -y supabase init >/dev/null 2>&1
  npx -y supabase link --project-ref "$SUPABASE_PROJECT_REF" >/dev/null 2>&1 && ok "supabase CLI link" || echo "INFO  supabase CLI link failed (optional: db-push.sh does not need it)"
}
need SUPABASE_POOLER_URL && {
  # node + pg from a scratch prefix: works on macOS and Linux without psql or sudo
  d="${TMPDIR:-/tmp}/30x-preflight-pg"; [ -d "$d/node_modules/pg" ] || npm i -s --prefix "$d" pg >/dev/null 2>&1
  NODE_PATH="$d/node_modules" node -e "const{Client}=require('pg');new Client({connectionString:process.env.SUPABASE_POOLER_URL,ssl:{rejectUnauthorized:false}}).connect().then(c=>c.query('select 1')).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})" 2>/tmp/pf-pg.err \
    && ok "pooler connection (6543)" || echo "WARN  pooler TCP unreachable from here ($(head -c 80 /tmp/pf-pg.err)); expected in the cloud sandbox (HTTPS only), the Worker connects from Cloudflare"
}

echo "== Email (Resend)"
need RESEND_API_KEY && need PREFLIGHT_TEST_EMAIL && {
  code=$(curl -s -o /tmp/resend.json -w "%{http_code}" https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
    -d "{\"from\":\"${RESEND_FROM:-onboarding@resend.dev}\",\"to\":[\"$PREFLIGHT_TEST_EMAIL\"],\"subject\":\"30x preflight\",\"text\":\"ok\"}")
  [ "$code" = "200" ] && ok "resend send ($code)" || bad "resend send ($code): $(cat /tmp/resend.json)"
  case "${RESEND_FROM:-onboarding@resend.dev}" in *@resend.dev) echo "WARN  RESEND_FROM is @resend.dev: mail reaches only the Resend sign-up address; verify a domain before any AC emails other people";; esac
}

if [ -n "${AWS_PROFILE_NAME:-}" ]; then
  echo "== AWS (reserve, never blocks the run: profile $AWS_PROFILE_NAME, region us-east-2)"
  export PATH="$HOME/.local/bin:$PATH"; unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN  # sandbox placeholders must not shadow the profile
  if ! command -v aws >/dev/null; then echo "WARN  aws cli missing (scripts/cloud-setup.sh installs it)"
  elif aws sts get-caller-identity --profile "$AWS_PROFILE_NAME" >/dev/null 2>&1; then
    ok "aws identity"
    [ "$(aws configure get region --profile "$AWS_PROFILE_NAME")" = "us-east-2" ] && ok "region us-east-2" || echo "WARN  profile region is not us-east-2"
    plan=$(aws freetier get-account-plan-state --profile "$AWS_PROFILE_NAME" --query accountPlanType --output text 2>/dev/null) && echo "INFO  account plan: $plan"
    aws agent-toolkit list-available-skills --region us-east-1 --profile "$AWS_PROFILE_NAME" >/dev/null 2>&1 && ok "agent toolkit" || echo "WARN  agent toolkit not reachable"
    [ -n "${S3_BUCKET:-}" ] && { echo ok > /tmp/pf.txt; aws s3 cp /tmp/pf.txt "s3://$S3_BUCKET/preflight.txt" --profile "$AWS_PROFILE_NAME" >/dev/null 2>&1 && aws s3 rm "s3://$S3_BUCKET/preflight.txt" --profile "$AWS_PROFILE_NAME" >/dev/null 2>&1 && ok "s3 put/delete" || echo "WARN  s3 put/delete on $S3_BUCKET failed"; }
  else
    echo "WARN  AWS LOGIN NEEDED: not signed in here. bash scripts/aws-login-remote.sh emails the sign-in URL; AWS tasks are parked until then, everything else continues"
  fi
fi

echo "== Clock"
python3 scripts/run_status.py | grep -q '(default)' && echo "WARN  DEADLINE not set in docs/CONTEXT.md; agents assume 2026-10-18T12:00-05:00" || ok "deadline set: $(python3 scripts/run_status.py | sed -n 's/^DEADLINE //p')"

echo "== Workers AI (product LLM)"
MODEL=$(sed -n 's/^WORKERS_AI_MODEL *= *"\([^"]*\)".*/\1/p' wrangler.toml); MODEL="${MODEL:-@cf/meta/llama-3.3-70b-instruct-fp8-fast}"
resp=$(curl -s -m 60 "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/$MODEL" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Responde solo con JSON: {\"ok\":true}"}],"response_format":{"type":"json_schema","json_schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}},"max_tokens":20}')
# WARN, not FAIL: the deployed Worker reaches Workers AI through its binding without any token; this REST call only proves it from the laptop.
echo "$resp" | grep -q '"success":true' && ok "workers ai $MODEL (json schema)" || echo "WARN  workers ai REST call failed: $(echo "$resp" | head -c 120). Authentication error = the Cloudflare token lacks the 'Workers AI' permission group (account-owned token: Manage Account -> Account API Tokens -> edit -> add Workers AI: Edit). Deploy is unaffected; the dry-run deploy proves the binding."
[ -n "${ANTHROPIC_API_KEY:-}" ] && { code=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/models -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"); [ "$code" = "200" ] && ok "anthropic api (optional)" || bad "anthropic api ($code)"; }
[ -n "${TYPESAFE_API_KEY:-}" ] && echo "INFO  typesafe key set (reserve, not tested)" || echo "INFO  typesafe key unset (reserve)"

echo "== Playwright"
npx -y playwright --version >/dev/null 2>&1 && ok "playwright cli" || bad "playwright cli"
ls ~/.cache/ms-playwright ~/Library/Caches/ms-playwright 2>/dev/null | grep -q chromium && ok "chromium installed" || { npx -y playwright install chromium --with-deps >/dev/null 2>&1 && ok "chromium installed now" || bad "chromium install"; }

echo "== Status channel (email heartbeat)"
[ -n "${HEARTBEAT_EMAIL:-}" ] && ok "heartbeat email set: $HEARTBEAT_EMAIL (Resend send proven above)" || echo "WARN  HEARTBEAT_EMAIL unset: heartbeats go to the ledger only"

echo "== Secrets hygiene"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
  git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vq '\.env\.example$' && bad ".env tracked by git" || ok "no .env tracked"
}

echo
[ "$FAILS" -eq 0 ] && { echo "PREFLIGHT PASSED"; exit 0; } || { echo "PREFLIGHT FAILED ($FAILS)"; exit 1; }
