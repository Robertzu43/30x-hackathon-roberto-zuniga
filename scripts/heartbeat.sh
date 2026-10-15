#!/usr/bin/env bash
[ -f .env ] && { set -a; . ./.env; set +a; }  # local laptop: load .env (gitignored); cloud session: env config instead
# Usage: scripts/heartbeat.sh "<5-line status>"  -> appends to docs/LEDGER.md and emails HEARTBEAT_EMAIL through Resend.
MSG="$1"; TS=$(date -u +"%Y-%m-%d %H:%MZ")
printf "\n## Heartbeat %s\n%s\n" "$TS" "$MSG" >> docs/LEDGER.md
TO="${HEARTBEAT_EMAIL:-}"
if [ -n "$TO" ] && [ -n "${RESEND_API_KEY:-}" ]; then
  code=$(curl -s -o /tmp/heartbeat.json -w "%{http_code}" -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
    --data "$(python3 -c 'import json,sys;print(json.dumps({"from":sys.argv[1],"to":[sys.argv[2]],"subject":"[30x "+sys.argv[3]+"] "+sys.argv[4].splitlines()[0][:70],"text":sys.argv[4]}))' "${RESEND_FROM:-onboarding@resend.dev}" "$TO" "$TS" "$MSG")")
  [ "$code" = "200" ] && echo "heartbeat emailed to $TO" || echo "heartbeat email failed ($code): $(head -c 120 /tmp/heartbeat.json)"
else
  echo "heartbeat: ledger only (HEARTBEAT_EMAIL or RESEND_API_KEY unset)"
fi
exit 0
