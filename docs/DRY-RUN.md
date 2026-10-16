# Launch, recovery and dry run

## Launch the real run (after brainstorming is done)
In the cloud, so it survives the laptop closing (environment `30x-hackathon`, see INFRA.md):
`claude --cloud "Read CLAUDE.md. First do 'Launcher session' rule 1 for a fresh start (set the RUN id). Then run writing-plans on docs/PROBLEM.md and docs/DECISIONS.md into docs/PLAN.md, dispatch product for docs/SPEC.md, then start the orchestrator as CLAUDE.md 'Launcher session' says. Do not ask me anything."`
Local fallback:
`claude --dangerously-skip-permissions -p "Read CLAUDE.md. First do 'Launcher session' rule 1 for a fresh start (set the RUN id). Then run writing-plans on docs/PROBLEM.md and docs/DECISIONS.md into docs/PLAN.md, dispatch product for docs/SPEC.md, then start the orchestrator as CLAUDE.md 'Launcher session' says. Do not ask me anything."`
(the settings.json allowlist covers the interactive case; the flag covers a headless run where prompts would hang)

Before launching: `docs/PROBLEM.md`, `docs/DECISIONS.md` and the `DEADLINE:` line in `docs/CONTEXT.md` are filled (the main session writes them with Roberto at kickoff). Old branches from earlier runs (`integration`, `task/*`, `archive/*`, `dryrun/*`) are ignored: each run works under its own `<RUN>/` namespace.

## Recovery
- The launcher's hourly `30x-watchdog` Routine wakes the session, also in a fresh container, and re-dispatches the orchestrator with RESUME when none is running.
- If the session itself is gone: start any session with `RESUME`. It deletes the old `30x-watchdog`, creates its own and continues from the ledger.

## How to run a dry run
1. Branch `dryrun/<name>` from `main` with a fake company in PROBLEM.md, DECISIONS.md and a `DEADLINE:` a few hours out. Push it.
2. Start a cloud session on that branch with the launch prompt above, prefixed with: "DRY RUN: branch dryrun/<name> plays the role of main. Never push to or merge into main; wherever CLAUDE.md or an agent says main, use dryrun/<name>."
3. Kill test: after one task has a done line on `origin/<RUN>/integration`, archive the session, unarchive it and fire its `30x-watchdog` (fresh container). Then archive it for good, delete its watchdog and start a new session with the same prefix and `RESUME`.
4. After the dry run, tell a cloud session "STOP DRY RUN <session>": it archives the session, deletes its `30x-watchdog` and deploys a placeholder Worker with no cron. Branches and tables stay; the next run uses its own `<RUN>/` branches and new table names, so nothing has to be deleted.

## Checklist and results (dry run 15 Oct 2026, fake company Rutas del Norte)
| Check | Result |
|---|---|
| Preflight passes in the cloud session | Proven |
| Worker deploy, Worker secrets (`scripts/worker-secrets.sh`), Supabase row read under RLS | Proven |
| Migration with RLS applied and dropped through `scripts/db-push.sh` | Proven |
| Plan, spec and all 8 MUST tasks built unattended, about 1h50m, zero questions to Roberto | Proven |
| Deployed URL serves `/`, `/demo`, `/mensajero`; API returns 401 without login | Proven |
| `docs/demo/happy-path.webm` recorded by QA with Playwright | Proven (watch it on your phone) |
| Reviewer catches real bugs (two money-parsing bugs fixed) | Proven |
| QA tests live auth and RLS in a 360x740 Chromium | Proven |
| Dispute path: QA FAIL to product ruling with the loser's argument ledgered | Proven |
| Kill mid-task, fresh-container wake, orchestrator restarted with RESUME | Proven; only the unpushed task was redone |
| Watchdog TICK while an orchestrator is live starts no second one | Proven |
| New session with only `RESUME` continues from the ledger | Proven |
| Watchdog fires hourly | Proven |
| Skill preload reaches builders and reviewer (headings quoted, incl. Ponytail "The ladder") | Proven |
| Nested subagents (spawn depth) | Proven |
| Secret scan blocks a fake `AKIA...` key | Proven |
| Heartbeat lines in the ledger | Proven; inbox delivery: Roberto confirms |
| FREEZE at T-6h, SHUTDOWN at T-2h, `RUN COMPLETE`, watchdog deleted at the end | Pending at the time of writing |
| Lint errors reach a builder | Not observed (no lint error occurred) |
| AWS sign-in and toolkit in subagents | Not tested (no AC needed AWS) |
| REA analyst on a toy API | Not tested (only runs when PROBLEM.md names a system) |

Cost of the dry run so far: about 17.50 USD across the two launcher sessions.

## Lessons applied to the harness after the dry run
- QA keeps tokens, cookies and dumps in one `mktemp -d` folder, never prints them, deletes it, and reseeds demo data (it had left login tokens at `/`).
- No agent polls with `sleep`; foreground Agent results and completion notices are the only way to wait (the orchestrator had busy-waited).
- Product decides every question about what the product does, disputed or not; the orchestrator rules on process only (it had set accepted money formats itself).
- RESUME is a ledger line `RESUMED at <task> <time>`, not a heartbeat line (heartbeats moved to the launcher).
- Worktrees live in `.worktrees/` (gitignored) and are removed after merge (the run had used two locations).
- Per-task QA runs against `wrangler dev` before the first deploy; the final happy path always against the deployed URL.
- Cloud sessions cannot delete GitHub branches (proxy 403) and the safety check refuses destructive SQL. So each run works under its own `<RUN>/` branch namespace, migrations are forward-only and additive, and a run never reuses a table name: no run ever needs a delete, and Roberto never has to clean up.
- `scripts/run_status.py` works from any folder and reports a mistyped deadline as `(invalid)`.
- Per-task QA tests the task's own worktree through `scripts/qa-server.sh` (gitignored mode-600 `.dev.vars`, bounded start, stop deletes it); the deployed URL is only for the final happy path.
- Only the orchestrator deploys, from `<RUN>/integration` after a merge and a green suite (a builder had deployed from its unmerged worktree).
- The orchestrator creates `<RUN>/integration` before the first task (the first tasks had been built in the main working tree).

## Still to verify by hand, once
- AWS, only if an AC will need it: ask a cloud session to run `scripts/aws-setup.sh`; you only open the sign-in link it emails or prints, on your phone.
- REA, only if PROBLEM.md names an existing system: a cloud session sets it up as `docs/RESOURCES.md` describes.
