#!/usr/bin/env bash
[ -f .env ] && { set -a; . ./.env; set +a; }  # local laptop: load .env (gitignored); cloud session: env config instead
# D41 (AC-92, AC-94, AC-95, AC-96; R-117, R-118): the Supabase Auth settings the trial needs, over the Management API.
# Run by the orchestrator only. No flag: PATCH them, then print them. --check: print them only. Prints those six keys and
# nothing else of the config, which carries secrets (SMTP password, provider secrets).
set -u
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}" "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}"
case "${1:-}" in ''|--check) ;; *) echo "usage: bash scripts/auth-config.sh [--check]"; exit 2;; esac
API="https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth"
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
call(){ curl -s -o "$OUT" -w '%{http_code}' -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' "$@" "$API"; }
if [ -z "${1:-}" ]; then
  c=$(call -X PATCH --data '{"external_anonymous_users_enabled":true,"rate_limit_anonymous_users":30,"mailer_autoconfirm":true,"password_min_length":8}')
  [ "$c" = 200 ] || { echo "FAIL auth config PATCH ($c)"; exit 1; }   # never the body: it may echo the config
  # Apart, so a plan without session controls cannot block the anonymous sign-in above (AC-94: 0 or unset passes).
  c=$(call -X PATCH --data '{"sessions_timebox":0,"sessions_inactivity_timeout":0}')
  [ "$c" = 200 ] || echo "WARN sessions_timebox / sessions_inactivity_timeout not set ($c); their current values follow"
fi
c=$(call) && [ "$c" = 200 ] || { echo "FAIL auth config read (${c:-no answer})"; exit 1; }
python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2:]: print(k, json.dumps(d.get(k)))' "$OUT" external_anonymous_users_enabled rate_limit_anonymous_users \
  mailer_autoconfirm password_min_length sessions_timebox sessions_inactivity_timeout
