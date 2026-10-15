# Resources available to the team

## Always on
- superpowers skills, vendored in `.claude/skills/`: brainstorming, writing-plans, subagent-driven-development, test-driven-development, verification-before-completion, requesting-code-review, finishing-a-development-branch. Preloaded into agents via `skills:` frontmatter.
- Ponytail, vendored in `.claude/skills/`: `ponytail` preloaded into builders at ULTRA level; `ponytail-review` preloaded into the reviewer.
- taste-skill pack (github.com/leonxlnx/taste-skill), vendored in `.claude/skills/`: `minimalist-ui` preloaded into builders for every UI; `design-taste-frontend` for the `/demo` page via the Skill tool. Both exist to keep AI-slop UI out.
- Cloudflare (wrangler) and GitHub (gh) auth in the cloud session.
- Workers AI (Cloudflare, `AI` binding, no key): the product LLM. Model name lives in wrangler.toml `[vars]`.

## Always on: AWS via Agent Toolkit
`aws-mcp` MCP server + AWS skills, profile `$AWS_PROFILE_NAME`, project Region us-east-2 (new AWS experience). Rules are in CLAUDE.md's marked AWS block; setup is `scripts/aws-setup.sh`. Use for S3/SES/Textract/Transcribe/Bedrock or the company's AWS-hosted systems when an AC needs it. Not the default stack.

## On standby: TypeSafe (System One / Jev) for fast typed decisions
Skill vendored at `.claude/skills/typesafe-ai/`. Plugin form, if a session wants it: `claude plugin marketplace add typesafe-ai/skills` then `claude plugin install typesafe@typesafe-ai`. Jev returns a typed judgment or probability in one fast call instead of generated text: route, rank, classify, verify.

### When it switches on
Only when an AC needs a yes/no, pick-one or score decision over natural language inside a hot loop (every incoming message, every row of an import) where the Anthropic call is too slow or too costly. Product names the AC in the task brief; without that, builders use `src/lib/llm.ts` with Anthropic as usual.

### Rules
- Same discipline as every model call: through `src/lib/llm.ts`, schema-validated, timeout, and a fallback (Anthropic or a plain rule) when TypeSafe is down. Tests mock it.
- `TYPESAFE_API_KEY` lives in the session env and `wrangler secret put`, never in the repo.
- The builder reads the live docs index first (https://docs.typesafe.ai/llms.txt); the skill says so.

## On standby: REA, reverse-engineering MCP
Repo: https://github.com/morluto/rea  Install: `npx rea-agents setup` (interactive, needs Node 22.19+; run it once on the laptop during the dry run, it registers the MCP server and its workflow skill). Update: `npx rea-agents@latest setup`. Scoped alternative that touches nothing global: `claude mcp add --scope local rea -- npx -y rea-agents@latest mcp` from the repo root before the analyst dispatch, `claude mcp remove --scope local rea` after. Native binaries need Ghidra/Hopper/IDA installed; web apps, JS/Electron, APKs and packet captures do not.
Purpose: understand an existing system we have no source for (a web app, an API, an export format, a device protocol) well enough to integrate with it or replace a piece of it.

### When it switches on
Only when `docs/PROBLEM.md` -> "Existing systems we may need to understand" names something concrete. Then, before `writing-plans`, the main session dispatches ONE `senior-builder` with the REA tools enabled and this brief:
- Target: <the system>. Question: <what we need to know to build AC-xx>.
- Time box: 90 minutes. Output: `docs/ANALYSIS-<system>.md` with: what it is, endpoints/formats/flows observed, what we can rely on, what we could not determine (stays "unknown", never guessed), and the exact commands or captures as evidence.
- Scope: the company's own systems, or public APIs they already use. Do not reverse-engineer third-party products beyond their public interfaces without a mentor saying it is fine; write the question to `docs/QUESTIONS.md` and continue without it.
- Secrets: anything captured (tokens, cookies, credentials) goes nowhere near the repo. Redact in the analysis file.

### Why it is not always on
REA loads a large tool catalog into context. With it on, every builder reasons worse about its own task. The analysis file is the handoff: builders read `docs/ANALYSIS-*.md`, they never carry REA themselves.

### Dry-run check
Run `npx rea-agents setup` once before Thursday so the install is cached, then disable it. Confirm a subagent can be dispatched with it enabled and produces an ANALYSIS file on a toy target (any public JSON API).
