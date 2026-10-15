# Dry run before Thursday

Fake company: a LATAM logistics firm whose dispatchers assign deliveries in WhatsApp and lose track.
Fill PROBLEM.md and DECISIONS.md for it, then run:

1. `/brainstorming` with Roberto in the loop (this is the only human-heavy step).
2. `/writing-plans` -> docs/PLAN.md.
3. Dispatch `product` to write docs/SPEC.md.
4. Dispatch `orchestrator` with the plan path.
5. Walk away for 2 hours. Come back and check: ledger has rulings, worktrees were used, tests ran, QA never saw briefs, at least one debate happened.

Launch for the real run (after brainstorming is done). In the cloud, so it survives the laptop closing (environment `30x-hackathon`, see INFRA.md):
`claude --cloud "Read CLAUDE.md and follow 'Launcher session'. Run writing-plans on docs/PROBLEM.md and docs/DECISIONS.md into docs/PLAN.md, dispatch product for docs/SPEC.md, then start the orchestrator as CLAUDE.md 'Launcher session' says. Do not ask me anything."`
Local fallback:
`claude --dangerously-skip-permissions -p "Read CLAUDE.md and follow 'Launcher session'. Run writing-plans on docs/PROBLEM.md and docs/DECISIONS.md into docs/PLAN.md, dispatch product for docs/SPEC.md, then start the orchestrator as CLAUDE.md 'Launcher session' says. Do not ask me anything."`
Recovery: start any session with `RESUME`; CLAUDE.md "Launcher session" handles it.
(the settings.json allowlist covers the interactive case; the flag covers a headless cloud session where prompts would hang)

Checklist to verify in the cloud session before kickoff:
- `bash scripts/preflight.sh` prints PREFLIGHT PASSED. Paste the KV id and Supabase URL/anon key into wrangler.toml, `wrangler secret put` the three secrets, `wrangler deploy` a hello-world that reads one row from Supabase; open the URL from your phone.
- Write one throwaway migration with RLS, `bash scripts/db-push.sh`, confirm it appears in the dashboard; then a second migration dropping it.
- Playwright: QA records `docs/demo/happy-path.webm` on the dry run; watch it on your phone.
- Email: the first heartbeat arrives in your inbox right after preflight passes, then every 5 hours.
- Kill the session mid-run, start a new one with "RESUME", confirm it continues from the ledger without redoing a finished task.
- AWS: `AWS_PROFILE_NAME=<profile> bash scripts/aws-setup.sh` once (you do the phone sign-in), new session, then preflight shows "aws identity", "agent toolkit" and the account plan. Leave it 13+ hours and run preflight again: if "aws identity (renewed)" appears, the silent renewal works unattended; if "AWS LOGIN NEEDED" appears, plan to do one phone sign-in per 12h on the weekend.
- Ask a subagent to list the loaded AWS skills and run `retrieve_skill` on one, to confirm the toolkit reaches subagents.
- The pre-commit secret scan blocks a commit containing a fake `AKIA...` key (try it).
- Skills are vendored in `.claude/skills/`, nothing to install. Dispatch `junior-builder` with a trivial task ("add a /health endpoint") and check its report: it must quote a heading from `test-driven-development`, from `minimalist-ui`, and from the Ponytail ruleset. Any "SKILL MISSING" means the `skills:` name in that agent's frontmatter does not match a directory under `.claude/skills/`.
- The full dry run completes with zero prompts to you. Any prompt = a gap in settings.json allow list or a hard stop that is too broad.
- gh auth and wrangler whoami succeed.
- CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH >= 3.
- Hooks fire (edit a file, see lint output). Session start prints "You have superpowers" and "PONYTAIL MODE ACTIVE — level: ultra"; a dispatched subagent's report shows the ultra ruleset reached it.
- REA: `npx rea-agents setup` run once, then disabled. Dispatch `senior-builder` as analyst on a toy public API and check `docs/ANALYSIS-*.md` appears with evidence and an "unknowns" section.
