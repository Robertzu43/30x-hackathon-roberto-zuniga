#!/usr/bin/env bash
# The orchestrator's QA server for one task worktree, so QA always tests the code under review.
#   start <worktree> [port]: write <worktree>/.dev.vars (mode 600, refused unless gitignored) from the session env,
#     build if there is a build script, start `npx wrangler dev` in the background, wait (bounded) until it answers,
#     print "QA_URL http://127.0.0.1:<port>". Never prints secret values.
#   stop <worktree>: kill the server and delete .dev.vars.
set -u
CMD="${1:?usage: qa-server.sh start|stop <worktree> [port]}"; WT="${2:?worktree path required}"; PORT="${3:-8787}"
cd "$WT" || exit 1
PIDF=.wrangler/qa-server.pid
stop() { [ -f "$PIDF" ] && { kill -- "-$(cat "$PIDF")" 2>/dev/null || kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; }; rm -f .dev.vars; }
case "$CMD" in
  stop) stop; echo "qa-server: stopped"; exit 0 ;;
  start) ;;
  *) echo "usage: qa-server.sh start|stop <worktree> [port]"; exit 2 ;;
esac
git check-ignore -q .dev.vars || { echo "qa-server: .dev.vars is not gitignored here; refusing to write secrets"; exit 1; }
stop  # a previous server for this worktree
( umask 077; : > .dev.vars
  for n in SUPABASE_SERVICE_ROLE_KEY SUPABASE_POOLER_URL RESEND_API_KEY TYPESAFE_API_KEY ANTHROPIC_API_KEY; do
    [ -n "${!n:-}" ] && printf '%s=%s\n' "$n" "${!n}" >> .dev.vars
  done )
mkdir -p .wrangler
if [ -f package.json ] && grep -q '"build"' package.json; then
  npm run -s build > .wrangler/qa-build.log 2>&1 || { echo "qa-server: build failed"; tail -20 .wrangler/qa-build.log; stop; exit 1; }
fi
setsid nohup npx wrangler dev --port "$PORT" --ip 127.0.0.1 > .wrangler/qa-server.log 2>&1 < /dev/null &
echo $! > "$PIDF"
# bounded wait for a process we started (allowed; polling for subagent results is not)
for _ in $(seq 1 120); do
  curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/" && { echo "QA_URL http://127.0.0.1:$PORT"; exit 0; }
  sleep 1
done
echo "qa-server: no answer on port $PORT after 120s"; tail -20 .wrangler/qa-server.log; stop; exit 1
