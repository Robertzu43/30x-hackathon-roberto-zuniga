#!/usr/bin/env bash
[ -f .env ] && { set -a; . ./.env; set +a; }  # local laptop: load .env (gitignored); cloud session: env config instead
# Headless AWS sign-in. Returns at once: if signed in, says so; otherwise starts `aws login --remote` in the background,
# emails Roberto the URL (10-minute window) and exits 0. Credentials land in this container when he completes it.
P="${AWS_PROFILE_NAME:-30x}"; export PATH="$HOME/.local/bin:$PATH"
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN  # sandbox placeholders must not shadow the profile
command -v aws >/dev/null || { echo "aws: cli missing (scripts/cloud-setup.sh installs it)"; exit 1; }
aws sts get-caller-identity --profile "$P" >/dev/null 2>&1 && { echo "aws: signed in ($P)"; exit 0; }
aws configure set region "${AWS_REGION:-us-east-2}" --profile "$P"
nohup aws login --profile "$P" --remote > /tmp/aws-login.txt 2>&1 &
for _ in $(seq 1 15); do sleep 1; grep -qE 'https://[^[:space:]]+' /tmp/aws-login.txt && break; done
URL=$(grep -oE 'https://[^[:space:]]+' /tmp/aws-login.txt | head -1)
[ -z "$URL" ] && { echo "aws: login printed no URL: $(head -c 200 /tmp/aws-login.txt)"; exit 1; }
bash scripts/heartbeat.sh "AWS LOGIN NEEDED: open this on your phone within 10 minutes: $URL
AWS tasks are parked until then; everything else continues."
echo "aws: LOGIN NEEDED, sign-in URL emailed"
exit 0
