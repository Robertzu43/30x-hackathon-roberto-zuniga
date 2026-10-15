# Infrastructure plumbing

Goal: every credential the agents need exists before kickoff, lives outside the repo, and `scripts/preflight.sh` proves it works in the cloud session with zero prompts.

## Decision (Roberto, 15 Oct): Cloudflare Workers + Supabase + Resend, AWS connected as a resource.
AWS access is through the Agent Toolkit for AWS (new AWS experience, project Region us-east-2). It gives agents an `aws-mcp` MCP server plus AWS skills. It is NOT the default stack; it is there for S3, SES, Textract/Transcribe/Bedrock or anything the company already runs on AWS. See "AWS via Agent Toolkit" below. The old IAM-user/access-key section is retired: the new experience manages human access itself and `aws login` replaces keys.
- Compute and deploy: Cloudflare Workers (Hono). KV only for cache/rate limits.
- Data, auth, files: Supabase. Postgres is the one database. Supabase Auth for users. Supabase Storage for files (R2 not used).
- Email: Resend.
One data layer. Builders do not create D1 databases or R2 buckets; a task that needs storage uses Supabase Storage.

## Supabase setup (do today)
1. Create a project in a fresh org `30x-hackathon`, region closest to the company (South America (São Paulo) for Colombia/LATAM). Free tier is fine; it pauses after 7 days idle, which does not matter this week.
2. Project ref `dhjumvswohajnusdifim`, URL `https://dhjumvswohajnusdifim.supabase.co` (already in `.env.example` and `wrangler.toml`). Still needed from the dashboard: anon key, service_role key, and the two connection strings:
   - Direct `db.dhjumvswohajnusdifim.supabase.co:5432`: for `supabase db push` and psql only. On the free tier this host is IPv6-only; if the cloud session has no IPv6 the CLI falls back to the pooler, so also get the pooler string.
   - Pooler, Transaction mode, port 6543 (Project Settings -> Database -> Connection string -> Transaction): this is what the Worker uses, since Workers open many short-lived connections and have no IPv6 guarantee. User is `postgres.dhjumvswohajnusdifim`, host `aws-0-<region>.pooler.supabase.com`.
   The DB password is a secret: session env (`SUPABASE_DB_URL`, `SUPABASE_POOLER_URL`) and `wrangler secret put SUPABASE_POOLER_URL`. Never in a file. The secret scan blocks any `postgres://user:pass@` line.
3. Create a personal access token (Account -> Access Tokens) named `30x-agent` so the CLI can link and push migrations: `SUPABASE_ACCESS_TOKEN`.
4. Auth: enable Email provider. Disable "Confirm email" for the hackathon unless the challenge needs it (otherwise QA cannot create users without inbox access); done by `curl -s -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"mailer_autoconfirm":true}'` (applied 15 Oct). Set Site URL to the Worker URL once deployed.
5. Storage: bucket `files`, private, comes from migration `supabase/migrations/20261015000000_files_bucket.sql` (`bash scripts/db-push.sh`). Access via signed URLs from the Worker.

### How agents use it
- Schema lives in `supabase/migrations/*.sql`, applied with `bash scripts/db-push.sh`: Supabase Management API over HTTPS, needs only the access token and project ref, works from the cloud sandbox where Postgres ports are closed, and records versions in `supabase_migrations.schema_migrations` so the CLI agrees. `supabase migration new <name>` still creates the files. Every migration ships with a `-- down` comment block. No schema changes through the dashboard.
- Row Level Security ON for every table from the first migration. The anon key is public by design (and the repo is public), so RLS is the only thing between the internet and the data. Reviewer treats a table without RLS as a finding at 100.
- Worker talks to Supabase with `@supabase/supabase-js` using the service_role key from `wrangler secret`, applying its own authorization checks, or with the user's JWT forwarded from the client when RLS should decide. Pick one per endpoint and say which in the code.
- Direct SQL from the Worker (if needed for reports): `postgres` package over the pooler URL. Not both ORMs; supabase-js first.
- Tests: Vitest against a local `supabase start` (Docker) when available; otherwise against the hosted project with a `test_` schema that migrations create and QA truncates. Say which in the report.
- Seed for `/demo`: `supabase/seed.sql`, idempotent, Spanish data, run by `scripts/seed.sh`.

### Secrets
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN` are secrets: session env + `wrangler secret put`. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are public config and may go in `wrangler.toml [vars]` and client code.

## AWS via Agent Toolkit (do once, in the cloud session)
1. Set `AWS_PROFILE_NAME=<profile>` in the session env.
2. `bash scripts/aws-setup.sh`: installs AWS CLI v2 and uv, runs `aws login --remote` (prints a URL you open on your phone and sign in with your social provider), verifies identity, runs the `aws configure agent-toolkit` wizard, points `aws-mcp` at your profile, lists the toolkit skills.
3. Start a new session; the MCP server and skills load from then on.
4. Facts that bind the weekend:
   - Login credentials last 12h and live in the container, so every cloud session starts signed out. `scripts/aws-login-remote.sh` starts the sign-in and emails you the URL; the "AWS LOGIN NEEDED" email is the one AWS thing you may have to do from your phone, and only if a task needs AWS.
   - All regional resources in us-east-2. No cross-Region anything. Toolkit commands on us-east-1.
   - Free plan supports a subset of services. SES may need the paid plan or "advanced features"; check `aws freetier get-account-plan-state` and the supported-services list during the dry run before promising email through SES. Resend stays the default sender.
   - Spend limit pauses the project when exceeded: set it in AWS Settings > Billing (USD 20 is plenty) and expect Access Denied to mean "limit hit" first.
5. Cleanup after Demo Day: the toolkit rules ask whether to keep or delete resources; product writes the list in the ledger, Roberto decides.

## Reference: Cloudflare-first, AWS optional
| Need | Default (Cloudflare) | Optional (AWS) | Pick AWS only if |
|---|---|---|---|
| Compute | Workers + Hono | Lambda | company runs on AWS |
| DB + Auth | Supabase Postgres + Auth (chosen) | RDS/Cognito | company runs on AWS |
| KV / cache | KV | — | — |
| Files | Supabase Storage (chosen); R2 unused | S3 | company already has S3 data |
| Email | Resend (instant, 3k/mo free) | SES | company insists on AWS; production access must be approved BEFORE kickoff |
| Queues / cron | Queues, Cron Triggers | SQS/EventBridge | same as compute |

Set the choice in `docs/DECISIONS.md` -> Stack. Both paths are wired below.

## Resend setup (do today)
1. Sign up at resend.com, create API key `30x-hackathon` with "Sending access" only.
2. Add and verify a domain you control (DNS: SPF, DKIM, DMARC records Resend shows). Verified domain = you can email anyone, including the company's people on Demo Day. Without it only `onboarding@resend.dev` works and it can only send to the email you signed up with.
3. Set `RESEND_API_KEY` and `RESEND_FROM=notificaciones@<your-domain>` in the session env, and `wrangler secret put RESEND_API_KEY` for the Worker.
4. Free tier: 3,000 emails/month, 100/day. Enough. If a challenge needs more, Pro is USD 20.
5. In the Worker, send via `fetch("https://api.resend.com/emails")` with the Bearer key; no SDK needed. Builders: wrap it in one `sendEmail({to, subject, html})` helper in `src/lib/email.ts`, log the Resend id in Postgres, and never send from tests (mock the fetch).

## Accounts to create or confirm (Roberto, today)
1. Cloudflare: Account ID `f23a90e15150a8af524f01d3bce393ab` (in `.env.example` and `wrangler.toml`). Workers Paid ($5/mo) so Queues and Cron have real limits. API token: My Profile -> API Tokens -> "Edit Cloudflare Workers" template (includes KV). An R2 token (from R2 -> Manage API tokens) cannot deploy Workers; it only grants R2 and comes with S3 keys. R2 keys are optional here since files live in Supabase Storage; if an AC wants R2, set `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in the session env and `wrangler secret put` them.
2. GitHub: a repo for the hackathon (public at submission, can be private until then). A fine-grained PAT or `gh auth login` in the session with repo + workflow scopes.
3. Resend: see "Resend setup" above.
4. AWS: via Agent Toolkit, see above. No IAM users, no access keys. If an AC needs S3: bucket `30x-<company-slug>-files` in us-east-2, block public access ON, signed URLs from the Worker. If an AC needs SES: verify sender today, request production access today; until approved only verified recipients work, and Resend remains the fallback.

## Frontend
Vite + React SPA served by the same Worker through Workers Static Assets (`[assets]` in wrangler.toml, directory `dist/`). One deploy, one URL, API under `/api/*`, SPA fallback for the rest. No Pages project, no second deploy target.

## AI inside the product
Most challenges will want some LLM step (classify a message, extract fields from a PDF, draft a reply). Provider (Roberto, 15 Oct): Workers AI, Cloudflare-hosted open models on the free tier (10,000 neurons/day, then pay-as-you-go). The Worker calls it through the `AI` binding (`[ai] binding = "AI"` in wrangler.toml; `env.AI.run(model, {messages, response_format, max_tokens})`); no API key anywhere. Default model: `WORKERS_AI_MODEL` in wrangler.toml `[vars]` (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`: JSON-schema output, good Spanish, fast); change the var, not the code. Rules: one helper `src/lib/llm.ts`; every call has max_tokens, a timeout, `response_format: {type: "json_schema"}` validated again in code, and a fallback path (a rule or a safe default) when the call fails or the daily quota is hit; tests mock it; prompts live in `src/prompts/*.md` so product can read them. `wrangler dev` runs the binding against the real Workers AI. Anthropic is not wired: only if `ANTHROPIC_API_KEY` appears in the session and product names the AC. Preflight proves the account can run the model over REST, which needs the Cloudflare token to carry the Workers AI permission; the deployed Worker needs no token.

## Browser testing and the demo recording
QA needs a browser to click the deployed app. Playwright with Chromium is installed in the session (`npx playwright install chromium --with-deps`). QA writes its happy-path checks as a Playwright script in `e2e/`, runs them against the deployed URL, and records the final run with `recordVideo` to `docs/demo/happy-path.webm`. That recording is the fallback demo if the live one fails and the first thing Roberto watches on Sunday.

## Status channel
The launcher sends the heartbeat every 5 hours (when `scripts/run_status.py` says `HEARTBEAT_DUE yes`) and it is emailed through Resend to `HEARTBEAT_EMAIL` (Roberto's inbox on his phone), 5 lines, same text as the ledger. PREFLIGHT FAILED, any hard stop, the T-6h freeze and the T-2h shutdown email immediately. If `HEARTBEAT_EMAIL` is unset, ledger only. Until a domain is verified in Resend, `onboarding@resend.dev` only delivers to the Resend sign-up address, so `HEARTBEAT_EMAIL` must be that address.

## CI
`.github/workflows/ci.yml` runs lint, typecheck and unit tests on every push. It gives judges green checks on the public repo and gives the orchestrator a second opinion when the local run is flaky. Deploy stays manual (`wrangler deploy` by the orchestrator), not CI, so a red CI never blocks a demo fix.

## Cloud environment (claude.ai/code): where the real run happens
The orchestrator must outlive Roberto's laptop, so the hackathon runs in a Claude Code cloud session. One-time setup in the web UI (Roberto, before kickoff):
1. Connect GitHub to the Claude account at https://claude.ai/connect-github. The cloud clones the repo from GitHub; without this nothing starts.
2. Environment at https://claude.ai/code (Environments): name `30x-hackathon`. Environment variables: the contents of `.env` without comments (on the laptop: `grep -vE '^#|^$' .env | pbcopy`, then paste). Network: full access (agents deploy, email, read docs). Setup script: `bash scripts/cloud-setup.sh`.
3. Launch from the laptop with `claude --cloud "<launch prompt from docs/DRY-RUN.md>"`, or start the session on the web. Then close the laptop; the session keeps running.
4. Every cloud session is a fresh container with HTTPS-only egress: raw TCP to Postgres (5432/6543) is blocked, which is why migrations go through the Management API. AWS needs one sign-in per session: `scripts/aws-login-remote.sh` emails you the URL. Everything else comes from the environment variables. `.mcp.json` in the repo registers the AWS MCP server for every session.
5. The launcher's hourly `30x-watchdog` Routine wakes the session (also in a fresh container) and restarts the orchestrator with RESUME; proven in the 15 Oct dry run. If the session itself is gone, start a new cloud session with the word RESUME (below).

## Session resilience
Cloud sessions can time out or hit limits. Everything that matters is on disk and in git: plan, spec, ledger, task branches. A new session resumes by reading `docs/LEDGER.md` and dispatching the orchestrator with "RESUME". Roberto's job when a session dies: start a new one with that one word.

## Standby integrations (not installed; enable at kickoff only if the challenge needs them)
- WhatsApp: LATAM operations run on it. Meta's API needs business verification (days). Twilio WhatsApp Sandbox works immediately for numbers that join the sandbox: good enough for a demo, say so in README. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
- Spreadsheets: companies will hand over Excel/CSV. SheetJS (`xlsx`) for import, with a preview-and-confirm step before writing to the DB.
- PDF: `pdf-parse` for text, Anthropic API with the document block for structured extraction.
- Maps/geocoding: Mapbox or Google; needs a key, ask at kickoff if routes/addresses matter.
- Payments: out of scope for a weekend. Mock the step and say so.

## Locale rules (product enforces)
Spanish UI, es-CO date format (dd/mm/yyyy), currency COP without decimals unless DECISIONS says otherwise, timezone America/Bogota stored as UTC in Postgres. Phone numbers in E.164.

## Where secrets live
- Cloud session: the session's environment variable configuration. Never in files the agents can commit.
- Worker runtime: `wrangler secret put NAME` per secret. Non-secret config goes in `wrangler.toml` `[vars]`.
- Repo: `.env.example` with names only. `.gitignore` has `.env*` and `.dev.vars`.
- Pre-commit hook blocks commits containing anything that looks like a key (see `.claude/hooks/secret-scan.sh`).

## Variables the agents expect
See `.env.example`. Also `HEARTBEAT_EMAIL` for heartbeats; `ANTHROPIC_API_KEY` is optional, Workers AI is the LLM. Required for every run: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GH_TOKEN` (or gh logged in), `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`.
AWS adds: `AWS_PROFILE_NAME` (login profile), `AWS_REGION=us-east-2`, and only if used `S3_BUCKET`, `SES_FROM`. No access keys anywhere.

## Preflight
`bash scripts/preflight.sh` runs: wrangler whoami + Workers API scope, KV create-or-confirm, git push access, Supabase (publishable key, secret key admin, Management API SQL; pooler TCP as a warning), Resend send to a test address, Workers AI inference, and AWS as warnings only. It prints PASS/FAIL/WARN per line and exits non-zero on any FAIL; only what deploy needs can FAIL. The orchestrator runs it as its first action and stops with "PREFLIGHT FAILED" if it fails, since nothing downstream can deploy.

## Deploy
`wrangler deploy` to `<project>.<your-subdomain>.workers.dev`. Custom domain only if DECISIONS.md asks. The deployed URL goes in README and the ledger. QA runs the happy path against it, not against localhost.
