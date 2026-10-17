#!/usr/bin/env bash
# Task 39 (AC-92, AC-94, AC-95, AC-96; R-117, R-118): scripts/auth-config.sh against a fake curl. It PATCHes exactly the
# trial's Auth keys, --check prints those keys only, and no run prints a secret of the config or the access token.
set -u
cd "$(dirname "$0")/../.." || exit 1
fail(){ echo "FAIL: $1"; exit 1; }
S=scripts/auth-config.sh
[ -f "$S" ] || fail "missing $S"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# The fake curl logs "<method> <url> <body>" and answers with a config that carries secrets; call n gets the n-th of
# $FAKE_CODES (default 200).
cat > "$T/curl" <<'FAKE'
#!/usr/bin/env bash
m=GET o= d= u=
while [ $# -gt 0 ]; do case "$1" in -X) m=$2; shift;; -o) o=$2; shift;; --data|-d) d=$2; shift;; -H|-w) shift;; http*) u=$1;; esac; shift; done
echo "$m $u $d" >> "$FAKE_LOG"
printf '%s' '{"external_anonymous_users_enabled":true,"rate_limit_anonymous_users":30,"mailer_autoconfirm":true,"password_min_length":8,"sessions_timebox":null,"sessions_inactivity_timeout":0,"smtp_pass":"s3cr3t-smtp","external_google_secret":"s3cr3t-google"}' > "$o"
n=$(wc -l < "$FAKE_LOG"); set -- ${FAKE_CODES:-}; shift $((n - 1)) 2>/dev/null || set --; printf '%s' "${1:-200}"
FAKE
chmod +x "$T/curl"
run(){ (cd "$T" && PATH="$T:$PATH" FAKE_LOG="$T/log" SUPABASE_ACCESS_TOKEN=sbp_tok3n SUPABASE_PROJECT_REF=ref1 bash "$OLDPWD/$S" "$@" 2>&1); }
API=https://api.supabase.com/v1/projects/ref1/config/auth
KEYS='external_anonymous_users_enabled true
rate_limit_anonymous_users 30
mailer_autoconfirm true
password_min_length 8
sessions_timebox null
sessions_inactivity_timeout 0'
nosecret(){ echo "$1" | grep -qE 's3cr3t|sbp_tok3n' && fail "$2 printed a secret: $1"; return 0; }

: > "$T/log"; out=$(run); code=$?
[ $code = 0 ] || fail "apply exited $code: $out"
nosecret "$out" apply
[ "$out" = "$KEYS" ] || fail "apply did not print the six keys (got: $out)"
[ "$(cat "$T/log")" = "PATCH $API {\"external_anonymous_users_enabled\":true,\"rate_limit_anonymous_users\":30,\"mailer_autoconfirm\":true,\"password_min_length\":8}
PATCH $API {\"sessions_timebox\":0,\"sessions_inactivity_timeout\":0}
GET $API " ] || fail "apply did not PATCH the trial keys then read them back (got: $(cat "$T/log"))"

: > "$T/log"; out=$(run --check); code=$?
[ $code = 0 ] || fail "--check exited $code"
nosecret "$out" --check
[ "$out" = "$KEYS" ] || fail "--check did not print exactly the six keys (got: $out)"
[ "$(cat "$T/log")" = "GET $API " ] || fail "--check wrote something (got: $(cat "$T/log"))"

: > "$T/log"; out=$(FAKE_CODES=401 run --check); code=$?
[ $code = 1 ] || fail "a refused read exited $code"
nosecret "$out" "a refused read"
echo "$out" | grep -q 'FAIL' || fail "a refused read did not say FAIL (got: $out)"

: > "$T/log"; out=$(FAKE_CODES=400 run); code=$?
[ $code = 1 ] || fail "a refused PATCH exited $code"
nosecret "$out" "a refused PATCH"
[ "$(wc -l < "$T/log")" = 1 ] || fail "went on after a refused PATCH"

# Session keys refused (a plan that lacks them): warned, and the read-back shows what is set (AC-94: 0 or unset passes).
: > "$T/log"; out=$(FAKE_CODES='200 402 200' run); code=$?
[ $code = 0 ] || fail "a refused sessions PATCH exited $code"
nosecret "$out" "a refused sessions PATCH"
echo "$out" | grep -q '^WARN' || fail "a refused sessions PATCH was not warned (got: $out)"
echo "$out" | grep -q '^external_anonymous_users_enabled true$' || fail "no read-back after a refused sessions PATCH"

out=$(run --nope); [ $? = 2 ] || fail "an unknown flag did not exit 2"
out=$( (cd "$T" && env -u SUPABASE_ACCESS_TOKEN PATH="$T:$PATH" FAKE_LOG="$T/log" SUPABASE_PROJECT_REF=ref1 bash "$OLDPWD/$S" --check 2>&1) ) && fail "ran without SUPABASE_ACCESS_TOKEN"
echo "auth-config.test: passed"
