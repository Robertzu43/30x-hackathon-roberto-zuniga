# 30X Hackathon Harness

## What this repo is
A company brought a real operational problem to the 30X Hackathon (Oct 16-18, 2026).
Roberto understood the problem at kickoff and wrote `docs/PROBLEM.md` and `docs/DECISIONS.md`.
Everything after that is executed by the agent team defined in `.claude/agents/`.
The deliverable must be deployable by the company on Monday, not a demo that dies on Sunday.

## Run anywhere (cloud or local)
This repo is the source of truth: agents (`.claude/agents/`), hooks (`.claude/hooks/`, `.githooks/`), skills (`.claude/skills/`), settings and scripts travel with the clone. Nothing is loaded from plugins or `~/.claude`.
1. Clone. Set every variable in `.env.example` in the session environment, never in a file.
2. `bash scripts/preflight.sh` must print PREFLIGHT PASSED.
3. Launch with the command in `docs/DRY-RUN.md`, or open Claude Code at the repo root and follow the pipeline below. A dead session resumes with "RESUME".

## Read first
`docs/CONTEXT.md` (the event, dates, rules, rubric) then `docs/PROBLEM.md` then `docs/DECISIONS.md`, then any `docs/ANALYSIS-*.md`. Tools and when they switch on: `docs/RESOURCES.md`. Every acceptance criterion in `docs/SPEC.md` must trace to one of those three files. Anything that does not trace is out of scope, no matter who proposes it.

## Chain of command
1. `docs/PROBLEM.md` and `docs/DECISIONS.md` are the source of truth. Roberto owns them. Nobody edits them except Roberto.
2. `product` owns `docs/SPEC.md` (acceptance criteria) and adjudicates every dispute. Product never writes code.
3. `senior-builder` and `junior-builder` write code, one task each, in their own git worktree.
4. `reviewer` reviews every task diff (Ponytail review + confidence-scored findings, reports only >= 95).
5. `qa` tests only against `docs/SPEC.md` acceptance criteria. QA never reads task briefs.
6. `orchestrator` runs the loop and keeps `docs/LEDGER.md`.

## Pipeline (do not skip stages)
0. Only if `docs/PROBLEM.md` names an existing system to understand: one time-boxed REA analysis task producing `docs/ANALYSIS-<system>.md` (see `docs/RESOURCES.md`). Builders read the analysis file; they never run REA themselves.
1. Roberto + main session: `brainstorming` until `docs/PROBLEM.md` and `docs/DECISIONS.md` are settled. This is the ONLY stage with a human in it.
2. Main session: `writing-plans` -> `docs/PLAN.md`. Then dispatch `product` to write `docs/SPEC.md`.
3. Main session: dispatch `orchestrator` with the plan path and walk away. It runs `subagent-driven-development` and `finishing-a-development-branch` to the end.

Skills are preloaded via the `skills:` list in each agent's frontmatter, so their full text is in the agent's context at startup. Each agent proves it by quoting a heading in its first report. The `Skill` tool stays as a fallback. Every skill the agents name lives in `.claude/skills/` in this repo (superpowers set, `ponytail`, `ponytail-review`, `minimalist-ui`, `design-taste-frontend`, `typesafe-ai`); no plugin install is needed in any session. If a skill is missing, the agent says so and continues with the rules in this file. The orchestrator dispatches one implementer per task,
one reviewer per task, one debate round when they disagree, Product rules, ledger records it.
A second reviewer on the same diff is a defect. A reviewer who rewrites code is a defect.

## Decision principles (borrowed from gstack autoplan, adapted)
- Claims need evidence. Name the command and its output. A mock is not a live check. "Done, unverified" is not done.
- Completeness over shortcuts. Edge cases, error paths and tests are in scope. Only genuinely unrelated work is out.
- Confusion protocol. Stop and write a question to `docs/QUESTIONS.md` only for: architecture choice, data model, destructive scope, missing company context. Everything else: make a ruling, log it, keep moving.
- Confusion protocol never blocks. Write the question to `docs/QUESTIONS.md`, take the most conservative option that keeps the company's data safe, log it in the ledger, continue. Roberto may overrule later; until then the ruling stands.
- Hard stops only for: `git push --force`, deleting branches with unmerged work, writing credentials into the repo, or deploying to infrastructure the company owns. Nothing else stops the run.

## Autonomy (pre-authorised by Roberto, do not ask again)
- Merging task worktrees into `integration`, and `integration` into `main` once the full suite and QA happy path pass.
- Deploying to Roberto's own Cloudflare account (`wrangler deploy`), including creating KV namespaces, and running `supabase db push` against the hackathon project.
- Installing npm dependencies when a builder justifies it in its report.
- Creating and deleting git worktrees and task branches.
- Running the full test suite, seeding demo data, rewriting README.
- If the plan is provably broken: `product` re-scopes, logs why, the run continues on the reduced scope. Do not wait for Roberto.
- One ruling per dispute. Product rules, the loser's argument goes in the ledger verbatim. No re-litigating.

## Anti-derail rules (these exist because nobody is watching)
- No conversations between agents. Agents only exchange four forms: builder report, reviewer findings, QA verdict, product ruling. Anything else is dropped by the orchestrator.
- One debate round per finding: builder position (5 lines) -> reviewer position (5 lines) -> product ruling. Nothing after the ruling.
- Budgets per task: 2 builder attempts, 2 reviewer passes, 2 QA runs, 2 product rulings. Hitting any budget sends the task to `product` for re-scope, not for another round.
- Loop guard: if a finding, failure or question repeats with the same substance, the orchestrator stops the loop and rules by the tie-breakers in `product`. No third occurrence.
- Objective anchor: every task cites AC ids. Every reviewer finding cites an AC id or a CLAUDE.md rule, or it is discarded. Nobody adds ACs except `product`, and only from CONTEXT/PROBLEM/DECISIONS.
- Ideas go to `docs/IDEAS.md`, never into code. A builder who wants to add something writes one line there and continues the task as briefed.
- Order of work: MUST ACs first, in dependency order. SHOULD ACs only when every MUST has passed QA. Demo requirements are MUST.
- Clock: `docs/CONTEXT.md` holds the upload deadline. At T-6h the orchestrator freezes features: only failing-test fixes, README, demo data and deploy. At T-2h: deploy, verify the URL on a clean session, final ledger summary, stop.
- Status heartbeat: every 5 hours of work the orchestrator runs `scripts/heartbeat.sh` (ledger + email to `HEARTBEAT_EMAIL` through Resend), and immediately on PREFLIGHT FAILED, any hard stop, the T-6h freeze and the T-2h shutdown. Five lines: done / in progress / blocked / rulings / next. This is what Roberto reads from his phone.
- Resume: a new session dispatches the orchestrator with "RESUME"; it continues from the ledger. Nothing is only in memory.

## Code rules (Ponytail ULTRA mode is on for every agent that writes code)
- Superpowers always: every build goes brainstorming -> writing-plans -> subagent-driven-development; every builder works test-driven-development then verification-before-completion; every merge goes through finishing-a-development-branch. No code outside that path, in any session.
- Minimum code that satisfies the acceptance criterion. No speculative abstractions.
- Never cut validation, auth, tests or error handling to save time.
- Every task ends with: tests passing, lint passing, a commit on the task branch, a 5-line report in the ledger.
- Ponytail: ULTRA is pinned for every session and every subagent by the repo's own hooks (`PONYTAIL_DEFAULT_MODE=ultra` in `.claude/settings.json`; SessionStart and SubagentStart inject the ruleset). `ponytail` is also preloaded into both builders and `ponytail-review` into the reviewer. Ultra is the floor, not a suggestion: if a builder thinks a rule should bend, it says so in its report and the reviewer or product rules; it does not bend it.
- Stack: TypeScript + Hono on Cloudflare Workers, Supabase (supabase-js, migrations via CLI), Resend, Vitest. See `docs/INFRA.md`.
- UI: Vite + React served by the Worker (Static Assets). Spanish copy, es-CO locale (see INFRA.md). Follow the preloaded `minimalist-ui` skill (leonxlnx taste-skill pack) on every page; it exists to keep AI-slop UI out.
- LLM calls: only through `src/lib/llm.ts`, schema-validated, with fallback. Provider is Workers AI through the `AI` binding (`env.AI.run`, model from the `WORKERS_AI_MODEL` var, JSON-schema `response_format`); no API key exists or is needed. Anthropic only if `ANTHROPIC_API_KEY` is set in the session and product names the AC. Typed yes/no or pick-one decisions in hot loops may use TypeSafe/Jev per `docs/RESOURCES.md`. Prompts in `src/prompts/`. The `design-taste-frontend` skill (same pack, invoke with the Skill tool) is for the `/demo` pitch page only.

## Infrastructure
`docs/INFRA.md` is the plumbing. Stack is Cloudflare Workers for compute and deploy, Supabase for Postgres, Auth and Storage (the only data layer; no D1, no R2), Resend for email, decided in `docs/DECISIONS.md`. Schema changes are migrations in `supabase/migrations/` only. Every table has RLS on from its first migration. Email goes through one helper `src/lib/email.ts`; tests mock it, nothing else calls Resend directly. The AWS path in INFRA.md is reference only. Secrets never enter the repo: env vars in the session, `wrangler secret put` for the Worker. The orchestrator's first action is `bash scripts/preflight.sh`; if it fails, the run stops with PREFLIGHT FAILED and nothing is built, because nothing could deploy.

## Hooks
- SessionStart: installs the git hooks path, injects `using-superpowers`, activates Ponytail ULTRA. SubagentStart: injects Ponytail ULTRA into every subagent.
- PostToolUse on Edit/Write: run lint on the touched file.
- Pre-commit (`.githooks/pre-commit`, installed by the SessionStart hook via `git config core.hooksPath .githooks`): secret scan (`.claude/hooks/secret-scan.sh`) then the test suite. Either failing blocks the commit.
- Stop hook: if `docs/LEDGER.md` has no entry for the current task, refuse to stop.

## Demo requirements (non-negotiable, product owns these)
- `README.md` with: the problem in the company's words, what was built, how to run, how to deploy, what's not done.
- `docs/LEDGER.md` with every ruling and every debate, readable by a non-engineer.
- A deployed URL on Cloudflare plus a `/demo` page with seeded data.
- One recorded happy path: the company's actual workflow, start to finish.

## Roberto check-ins
Roberto is competing in another hackathon simultaneously and checks in from his phone.
When he does, give him: done / in progress / blocked / rulings made since last check-in. Five lines max. Never wait for him. `docs/QUESTIONS.md` is informational; every item in it already has a provisional ruling in the ledger.

<!-- BEGIN AWS Agent Toolkit rules -->
# AWS Guidance for the new AWS experience

This user has signed up for the new AWS experience. This experience lets you sign into AWS using a social provider and requires the following additional context.

Where this guidance conflicts with the project's own instructions, the project's instructions take precedence.

## Context

### Terminology:

- Say "project" instead of "account" — a project contains an AWS account and settings for sharing with other collaborators
- Say "team member" instead of "IAM user" — users are invited by email, not created or federated in IAM
- Say "AWS Settings" when referring to management tasks at [settings.aws.com](https://settings.aws.com/) (project management, billing, team members, spend limits). Users view their actual AWS resources in the AWS Management Console.
- Say "selected Region" when referring to the user's Region — not "home Region"
- The user has a managed IAM experience. This includes a managed service control policies (SCP) and resource control policies (RCP) that govern the use of AWS. They will still need to use IAM to create policies to let services work with each other. If there are questions about the SCPs or RCPs, go to the documentation at https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html

### Constraints:

- All projects share a single AWS Region determined by the user's contact address. Resources cannot be created in other Regions
- When developing:
  - MUST create all Regional resources in the project's assigned Region
  - You CAN create AWS WAF and Cloudwatch Logs resources in us-east-1 when there are global resources (like a global WAF instance) that require a connection to dependencies in us-east-1. You should not use these for any other reason, because resources in the selected Region will provide lower cost (due to no cross-Region traffic), increased availability (due to no cross-Region traffic), and easier manageability (due to not needing to look in another Region). When you need to do an inventory of resources, you need to look in both the selected Region and us-east-1 for Cloudwatch Logs or WAF resources.
  - MUST NOT attempt to create Lambda, API Gateway, or other Regional resources in any other Region
  - MUST direct users to confirm their Region in AWS Settings > View all projects > Overview > Additional Info > Region. If the user cannot confirm their Region, check in ~/.aws/config
  - MUST NOT use Lambda@Edge — excluded from both Lambda and CloudFront
  - MUST NOT use CloudFormation StackSets — no multi-account or multi-Region deployments
  - MUST NOT attempt cross-Region actions — no cross-Region replication for DynamoDB/S3/RDS, no multi-Region KMS keys
  - MUST NOT use Route 53 cross-Region routing — geolocation, latency-based, and failover routing policies are not available
  - CloudFront is a global service and its actions ARE allowed in `us-east-1`. A user can create a CloudFront distribution pointing to their project-region Lambda function URL or API Gateway. However, Lambda and API Gateway themselves MUST NOT be created in `us-east-1` — they must be in the project Region.
  - Reduced availability in `eu-north-1` specifically: Amazon Rekognition, Amazon Textract, Amazon Personalize, AWS App Runner are not available in that Region.
- IAM permissions for human access are managed by AWS. Don't assign roles to team members unless absolutely necessary
- The user may have a spend limit if they are on the paid plan. The limit that pauses their project if it's exceeded. If resources suddenly become inaccessible, ask if they have a spend limit configured. Only project owners can modify a spend limit.
- When developing:
  - MUST ask about spend limit status if the user reports sudden "Access Denied" errors on operations that previously worked
  - MUST direct users to check spend status in AWS Settings > Billing
  - MUST check if a user has upgraded their account to the paid plan
  - MUST ask the user if they want to clean up the successfully created resources or keep them to reduce cost
- The user sets up billing, creates spend limits, and retrieves and pays invoices in AWS Settings. The user creates budgets and optimizes their costs in the AWS Billing and Cost Management console
- Not all AWS services are available. If a service isn't working, do the following:
  1. Run the command `aws freetier get-account-plan-state`
  2. If accountPlanType": "FREE", check the [Free Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-free-tier) next,
  3. If accountPlanType": "PAID", check the [Paid Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-paid-plan).
  4. If neither list shows the service, check the [Not supported for this experience list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#unsupported-services). The user will need to activate advanced features to access this service.
- Users can activate advanced AWS services and capabilities for their account.
- Before starting a task, check whether a relevant AWS skill is available. Load the skill with retrieve_skill and prefer its guidance over general knowledge.

### Help level

- help_level (required): LOW, MEDIUM, or HIGH. While a user is building, you MUST ask the user: "How much guidance would you like from me? Low (I only flag security risks), medium (I ask a couple of clarifying questions if something seems off), or high (I explain what I'm doing, suggest alternatives, and flag best practices)."

You CAN update this rule file to save a user's help_level.

Constraints for each level:

**LOW:**

- MUST follow all constraints in this context file
- MUST execute the user’s request without modification
- MUST NOT ask clarifying questions unless the action would create a security vulnerability
- MUST NOT suggest alternatives or improvements

**MEDIUM:**

- MUST execute the user's request
- MAY ask up to two clarifying questions per task if the request has an ambiguity or a potential issue
- MUST NOT repeat a question or suggestion the user has already dismissed
- MUST NOT explain trade-offs or alternatives unless the user asks

**HIGH:**

- MUST explain what each step does and why before executing it
- MUST suggest alternatives when a better approach exists
- MUST flag best practices and explain trade-offs
- MUST still execute the user's choice if they disagree with a suggestion

### Project overrides (this repo wins where they conflict)
- Profile: `${AWS_PROFILE_NAME}` (set in session env). Region: us-east-2 for every regional resource. Agent Toolkit commands: us-east-1.
- help_level: LOW. Nobody is watching; do not ask, flag only security risks in the ledger.
- AWS is an available resource, not the default stack. Compute/deploy stay on Cloudflare Workers, data on Supabase, email on Resend (docs/DECISIONS.md). Use AWS when an AC needs S3-style object storage the company already uses, SES, Textract/Transcribe/Bedrock, or anything the company's own systems live on. Say which AC in the task brief.
- Spend: the project has a spend limit. On sudden Access Denied, log "possible spend limit" in the ledger and continue on non-AWS paths.
- Credentials come from `aws login`, valid 12h. The orchestrator runs `aws sts get-caller-identity --profile $AWS_PROFILE_NAME` in every heartbeat; on ExpiredToken it runs `aws login --profile $AWS_PROFILE_NAME --remote` once (90-day silent renewal) and, if that still fails, emails "AWS LOGIN NEEDED" and continues on non-AWS paths.
- Before any AWS task, load the matching toolkit skill (`retrieve_skill`) and prefer it. Never create IAM users or access keys; team access is managed by AWS.
<!-- END AWS Agent Toolkit rules -->
