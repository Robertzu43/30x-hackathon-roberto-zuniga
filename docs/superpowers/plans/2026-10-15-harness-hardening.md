> **SUPERSEDED (16 Oct 2026).** Executed and then replaced by later changes: branches are now `<RUN>/integration` and `<RUN>/task/*`, nothing is ever deleted, LEFTOVER RUN and archive-run.sh are gone. CLAUDE.md, `.claude/agents/` and `docs/DRY-RUN.md` are the current rules; do not follow this file.

# Harness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 12 gaps found in the harness robustness assessment, so that an unattended cloud run survives container loss, keeps its own clock, never stalls on a question, and is proven by a full dry run before kickoff.

**Architecture:** Three small scripts carry the mechanics. `sync.sh` pushes work to GitHub. `run_status.py` is the deterministic clock and health report. `.gitattributes` makes append-only docs merge cleanly. The launcher session owns the timer: an hourly Routine wakes it, it reads `run_status.py`, sends heartbeats and re-dispatches the orchestrator with RESUME when needed. The rest is prompt and config edits, then a live deploy and an end-to-end dry run on throwaway branches.

**Tech Stack:** bash, python3 stdlib (unittest), git, wrangler, Supabase Management API, claude-code-remote Routines (`create_trigger`).

**Spec:** The harness robustness assessment from this session. Its findings are F1 to F12 below. `CLAUDE.md` and `docs/INFRA.md` remain the binding rules.

| Id | Finding | Task |
|---|---|---|
| F1 | Nothing pushes ledger, task or integration branches to GitHub | 2, 4 |
| F2 | One long orchestrator call; no timer for heartbeats; nothing restarts it | 3, 4 |
| F3 | SDD and finishing skills say stop and ask on merge, push, publish | 5 |
| F4 | Worker never deployed, no Worker secrets, no migration pushed, RESUME untested | 8, 9, 10 |
| F5 | Builders append to `docs/LEDGER.md` in branches, so every merge conflicts | 1 |
| F6 | Lint hook exits 0, so agents never see lint output; eslint errors without config | 6 |
| F7 | Stop hook checks the main session's branch, so it never fires | 3, 4 |
| F8 | Ponytail SubagentStart injection does not reach subagents | 7 |
| F9 | Supabase "Confirm email" on; `files` bucket missing | 8 |
| F10 | Sender `onboarding@resend.dev` only delivers to Roberto | 8, R1 |
| F11 | Deadline hour blank, so freeze and shutdown never trigger | 3, 8 |
| F12 | SDD allows 5 fix rounds vs CLAUDE.md cap 2; SDD keeps a second ledger | 5 |

## Global Constraints

- No product code on `main` before kickoff (`docs/CONTEXT.md`: "Building before kickoff is not allowed"). Dry-run code lives only on `dryrun/*` branches.
- Never `git push --force`. Never delete a branch with unmerged work, or drop live tables, without Roberto confirming (CLAUDE.md hard stops).
- Secrets never enter a file. Worker secrets go through `wrangler secret put` from session env.
- Harness scripts use bash and python3 stdlib only. No new dependencies.
- `docs/PROBLEM.md` and `docs/DECISIONS.md` are edited on `dryrun/*` only, never on `main`.
- `scripts/preflight.sh` gets WARN lines only in this plan, never a new FAIL.
- Timezone: deadlines without an offset are America/Bogota, UTC-05:00, no DST.
- Commit messages in English, ending with the session attribution lines.

## Review Focus

1. **Container reclaimed between heartbeats.** At most one task of work may be lost. The orchestrator runs `sync.sh` after every merge (Task 4). Pinned by the dry-run kill test in Task 10.
2. **Push rejected because the remote diverged**, for example Roberto pushed from his laptop. `sync.sh` must not force, must name the branch and must exit 0 (Task 2, divergence test).
3. **Deadline written without an offset**, like `2026-10-18 18:00`. It must be read as Bogota time, not UTC (Task 3, naive-deadline test).
4. **Fresh worktree without node_modules or eslint config.** The lint hook must stay silent and exit 0, never block (Task 6, no-config test).
5. **Two orchestrators running at once** after a RESUME while the old Routine still fires. The launcher deletes every existing `30x-watchdog` Routine before creating its own (Task 4). Pinned by the RESUME step in Task 10.

---

### Task 1: Harness test runner and conflict-free append-only docs (F5)

**Files:**
- Create: `scripts/tests/run.sh`
- Create: `scripts/tests/ledger-merge.test.sh`
- Create: `.gitattributes`
- Modify: `.githooks/pre-commit` (run harness tests before `npm test`)
- Modify: `.github/workflows/ci.yml` (add an unconditional step)
- Modify: `.claude/agents/junior-builder.md` ("Never touch docs other than docs/LEDGER.md")
- Modify: `.claude/agents/senior-builder.md` ("Never touch" list)
- Modify: `CLAUDE.md:68` ("a 5-line report in the ledger")

**Interfaces:**
- Produces: `bash scripts/tests/run.sh` runs every `scripts/tests/*.test.sh` and `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`, but runs the Python step only when a `scripts/tests/test_*.py` file exists, because Python 3.12+ exits 5 when discovery finds zero tests. Exit 0 only if all pass, and print `FAIL <file>` per failing shell test. Later tasks add tests here.

- [ ] **Step 1: Write the failing test `scripts/tests/ledger-merge.test.sh`**

It builds a temp repo, copies the repo-root `.gitattributes` into it, and commits `docs/LEDGER.md`, `docs/IDEAS.md` and `docs/QUESTIONS.md`. On two branches it appends `line from A` and `line from B` to each file, then merges B into A.
```bash
git merge -q --no-edit b            # must exit 0
grep -q 'line from A' docs/LEDGER.md && grep -q 'line from B' docs/LEDGER.md
grep -q 'line from A' docs/IDEAS.md  && grep -q 'line from B' docs/IDEAS.md
! grep -q '<<<<<<<' docs/LEDGER.md docs/IDEAS.md docs/QUESTIONS.md
```

- [ ] **Step 2: Create `scripts/tests/run.sh` and run it**

Run: `bash scripts/tests/run.sh`
Expected: `FAIL scripts/tests/ledger-merge.test.sh`, because `.gitattributes` does not exist yet.

- [ ] **Step 3: Create `.gitattributes`**

```
docs/LEDGER.md merge=union
docs/IDEAS.md merge=union
docs/QUESTIONS.md merge=union
```

- [ ] **Step 4: Make the orchestrator the only ledger writer**

In both builder files, builders never edit any file under `docs/` except one line in `docs/IDEAS.md`. Their report is their final message, and the orchestrator writes it to the ledger. In CLAUDE.md, line 68 ends with "a 5-line report returned to the orchestrator, which writes it to the ledger".

- [ ] **Step 5: Wire the runner**

Add `bash scripts/tests/run.sh || exit 1` to `.githooks/pre-commit`, after the secret scan and before `npm test`. Add a CI step `- run: bash scripts/tests/run.sh` with no `if:`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bash scripts/tests/run.sh`
Expected: exit 0, no `FAIL` lines.

- [ ] **Step 7: Commit**

`git add .gitattributes scripts/tests .githooks/pre-commit .github/workflows/ci.yml .claude/agents/junior-builder.md .claude/agents/senior-builder.md CLAUDE.md && git commit -m "harness: union-merge append-only docs, orchestrator sole ledger writer, harness test runner"`

---

### Task 2: Push work to GitHub (F1)

**Files:**
- Create: `scripts/sync.sh`
- Create: `scripts/tests/sync.test.sh`
- Modify: `scripts/heartbeat.sh` (call sync after appending)

**Interfaces:**
- Consumes: `scripts/tests/run.sh` (Task 1).
- Produces: `bash scripts/sync.sh`, always exit 0. It stages whichever of `docs/LEDGER.md docs/QUESTIONS.md docs/IDEAS.md docs/SPEC.md docs/PLAN.md` exist and commits them on the current branch if changed, with message `ledger: sync <UTC ISO minute>`. Then it runs `git push -u origin <b>` for each local branch in `main`, `integration` and `task/*`, never with force. Last stdout line: `sync: committed <yes|no>, pushed <n>, failed <space-separated branch names or none>`.

- [ ] **Step 1: Write the failing test `scripts/tests/sync.test.sh`**

Setup: a temp bare `origin.git` and a clone with `main`, `task/01-a` (one commit) and `integration` checked out, where `docs/LEDGER.md` has an uncommitted line `task/01-a done`. A second clone pushes a different commit to `task/02-b` on origin, and the first clone also has a local, divergent `task/02-b`.
```bash
out=$(bash "$ROOT/scripts/sync.sh"); test $? -eq 0
git --git-dir="$T/origin.git" rev-parse -q --verify refs/heads/integration
git --git-dir="$T/origin.git" rev-parse -q --verify refs/heads/task/01-a
git --git-dir="$T/origin.git" show integration:docs/LEDGER.md | grep -q 'task/01-a done'
echo "$out" | tail -1 | grep -q 'failed task/02-b'
test "$(git --git-dir="$T/origin.git" rev-parse task/02-b)" = "$REMOTE_02B_SHA"   # not overwritten
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/tests/sync.test.sh`
Expected: FAIL, because `scripts/sync.sh` does not exist.

- [ ] **Step 3: Implement `scripts/sync.sh` to the interface above**

Use `git for-each-ref --format='%(refname:short)' refs/heads/main refs/heads/integration refs/heads/task` for the branch list. Use `git add --` with only existing paths, because a missing pathspec makes `git add` fail entirely.

- [ ] **Step 4: Call it from the heartbeat**

In `scripts/heartbeat.sh`, run `bash scripts/sync.sh` right after the `printf ... >> docs/LEDGER.md` line, before the email.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bash scripts/tests/run.sh`
Expected: exit 0.

- [ ] **Step 6: Commit**

`git add scripts/sync.sh scripts/tests/sync.test.sh scripts/heartbeat.sh && git commit -m "harness: sync.sh pushes ledger and branches without force; heartbeat syncs"`

---

### Task 3: Deterministic clock and run health report (F2, F7, F11)

**Files:**
- Create: `scripts/run_status.py`
- Create: `scripts/tests/test_run_status.py`
- Modify: `docs/CONTEXT.md:12`

**Interfaces:**
- Produces, in `scripts/run_status.py`:
  - `parse_deadline(context_text: str) -> tuple[datetime, str]` returns an aware UTC datetime, plus `"set"` or `"default"`. It reads the first line matching `^DEADLINE:\s*(.+?)\s*$`. Naive values are taken as UTC-05:00. Unparseable or missing values fall back to `DEFAULT_DEADLINE = "2026-10-18T12:00-05:00"`.
  - `last_heartbeat(ledger_text: str) -> datetime | None` reads the last `^## Heartbeat (\d{4}-\d{2}-\d{2} \d{2}:\d{2})Z`, the format `heartbeat.sh` writes.
  - `report(now: datetime, context_text: str, ledger_text: str, branches: list[str]) -> dict` returns these keys:
    - `phase`: `BUILD` if more than 6h left, `FREEZE` if 6h or less, `SHUTDOWN` if 2h or less, `OVER` if 0h or less.
    - `deadline` and `deadline_source`.
    - `hours_left`: a float rounded to 1 decimal.
    - `heartbeat_due`: True if there is no heartbeat, or the last one is 5h old or older.
    - `run_complete`: True if any line starts with `RUN COMPLETE`.
    - `unledgered`: the branches whose names do not appear anywhere in the ledger, sorted.
  - CLI: `python3 scripts/run_status.py`. It reads `docs/CONTEXT.md`, `docs/LEDGER.md` and branches from `git for-each-ref refs/heads/task refs/remotes/origin/task`, with `origin/` stripped and duplicates removed. It prints exactly these lines:
    ```
    PHASE <phase>
    DEADLINE <YYYY-MM-DDTHH:MMZ> (<set|default>)
    HOURS_LEFT <n.n>
    HEARTBEAT_DUE <yes|no>
    RUN_COMPLETE <yes|no>
    UNLEDGERED <space-separated or none>
    ```

- [ ] **Step 1: Write the failing tests `scripts/tests/test_run_status.py`**

The test inserts `Path(__file__).resolve().parents[1]` at `sys.path[0]` and imports `run_status`. Helper: `Z = lambda s: datetime.fromisoformat(s).astimezone(timezone.utc)`.
```python
CTX = "DEADLINE: 2026-10-18T18:00-05:00\n"          # = 23:00Z
def test_phases(self):
    for now, phase in [("2026-10-16T12:00Z","BUILD"), ("2026-10-18T18:00Z","FREEZE"),
                       ("2026-10-18T21:30Z","SHUTDOWN"), ("2026-10-18T23:01Z","OVER")]:
        self.assertEqual(report(Z(now), CTX, "", [])["phase"], phase)
def test_default_deadline(self):
    d, src = parse_deadline("Exact hour: <Roberto fills at kickoff>")
    self.assertEqual((d, src), (Z("2026-10-18T17:00Z"), "default"))
def test_naive_deadline_is_bogota(self):
    self.assertEqual(parse_deadline("DEADLINE: 2026-10-18 18:00")[0], Z("2026-10-18T23:00Z"))
def test_heartbeat_due(self):
    led = "## Heartbeat 2026-10-16 10:00Z\nx\n"
    self.assertTrue(report(Z("2026-10-16T10:00Z"), CTX, "", [])["heartbeat_due"])
    self.assertFalse(report(Z("2026-10-16T14:59Z"), CTX, led, [])["heartbeat_due"])
    self.assertTrue(report(Z("2026-10-16T15:00Z"), CTX, led, [])["heartbeat_due"])
def test_run_complete(self):
    self.assertTrue(report(Z("2026-10-16T10:00Z"), CTX, "a\nRUN COMPLETE 2026-10-18\n", [])["run_complete"])
def test_unledgered(self):
    r = report(Z("2026-10-16T10:00Z"), CTX, "task/01-schema done", ["task/02-api", "task/01-schema"])
    self.assertEqual(r["unledgered"], ["task/02-api"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`
Expected: ERROR, `No module named 'run_status'`.

- [ ] **Step 3: Implement `scripts/run_status.py` to the interface above**

- [ ] **Step 4: Make the deadline machine-readable**

Replace `docs/CONTEXT.md` line 12 with two lines. The second line starts at column 0 so the regex matches it.
```
- 18 Oct: deadline to upload the project. Roberto writes the exact time on the next line at kickoff; until then agents assume 2026-10-18T12:00-05:00.
DEADLINE: <Roberto fills at kickoff, ISO with offset, e.g. 2026-10-18T18:00-05:00>
```

- [ ] **Step 5: Run tests and the CLI**

Run: `bash scripts/tests/run.sh && python3 scripts/run_status.py`
Expected: exit 0, then six lines with `DEADLINE 2026-10-18T17:00Z (default)` and `UNLEDGERED none`.

- [ ] **Step 6: Commit**

`git add scripts/run_status.py scripts/tests/test_run_status.py docs/CONTEXT.md && git commit -m "harness: run_status.py clock, heartbeat-due and unledgered-branch report"`

---

### Task 4: Launcher owns the timer; orchestrator syncs and resumes from origin (F1, F2, F7)

**Files:**
- Modify: `CLAUDE.md` (lines 60-62, 81, and a new section "Launcher session" after "Pipeline")
- Modify: `.claude/agents/orchestrator.md` (sections "Resume", "Heartbeat", and "Your loop" step 2g)
- Modify: `docs/DRY-RUN.md:13,15` (launch prompts)
- Modify: `.claude/settings.json` (remove the `Stop` hook block)
- Delete: `.claude/hooks/ledger-check.sh`

**Interfaces:**
- Consumes: `scripts/sync.sh` (Task 2) and the `run_status.py` output lines (Task 3).
- Produces: the ledger marker `RUN COMPLETE <UTC ISO minute>`, written only by the orchestrator as its last ledger line. Also the Routine name `30x-watchdog`, cron `0 * * * *`, prompt `TICK`, bound to the launcher session.

- [ ] **Step 1: Add the "Launcher session" section to CLAUDE.md**

The section is these numbered rules, verbatim in substance:
1. **On start (fresh or RESUME).** Run `git fetch origin`. If `origin/integration` exists, run `git checkout integration`. List Routines and delete every one named `30x-watchdog`. Create one: `create_trigger` with name `30x-watchdog`, cron `0 * * * *`, prompt `TICK`, `initiation: human_request`, bound to this session. Dispatch `orchestrator` in the background with `docs/PLAN.md` on a fresh start, or `RESUME` otherwise.
2. **On every wake** (a `TICK` or an orchestrator completion notice): run the `git fetch` and checkout from rule 1, then `python3 scripts/run_status.py`.
   - **`HEARTBEAT_DUE yes`:** write five lines from the ledger tail (done / in progress / blocked / rulings since last / next). Then run `bash scripts/heartbeat.sh "<lines>"`.
   - **Orchestrator not running, `RUN_COMPLETE no`, and `PHASE` not `OVER`:** dispatch `orchestrator` with `RESUME` in the background.
   - **`RUN_COMPLETE yes` or `PHASE OVER`:** send a final heartbeat, run `bash scripts/sync.sh`, delete `30x-watchdog`, and stop.
3. The launcher never writes product code and never dispatches builders.

- [ ] **Step 2: Update the CLAUDE.md "Anti-derail" and "Hooks" lines**

Line 60: the clock is `PHASE` from `python3 scripts/run_status.py`, which the orchestrator runs before every task dispatch.

Line 61: the launcher sends the periodic heartbeat. The orchestrator sends the immediate ones: PREFLIGHT FAILED, a hard stop, the first FREEZE, the first SHUTDOWN.

Line 62: RESUME begins by fetching origin. `sync.sh` runs after every merge and every heartbeat, so nothing lives only in the container.

Line 81: delete the Stop hook bullet. Add a bullet saying that `UNLEDGERED` in `run_status.py` replaces it and that RESUME reconciles those branches first.

- [ ] **Step 3: Update `orchestrator.md`**

**Resume:** start with `git fetch origin`, check out `integration` if it exists on origin, and run `python3 scripts/run_status.py`. Reconcile each `UNLEDGERED` branch first: review, then QA, then merge, or ledger it as abandoned with a reason. Create a local branch from `origin/task/<x>` when only the remote copy exists. Then continue from the last task without a done line.

**Heartbeat:** keep only the immediate triggers. The 5-hourly timer belongs to the launcher.

**Step 2g:** after each merge into integration, run `bash scripts/sync.sh`.

**Clock rule:** run `run_status.py` before each dispatch and obey `PHASE`.
- `FREEZE`: only failing-test fixes, README, demo data and deploy.
- `SHUTDOWN`: deploy, verify the URL, final summary, then `RUN COMPLETE`.
- `OVER`: write `RUN COMPLETE` and stop.

After `RUN COMPLETE`, run `bash scripts/sync.sh`.

- [ ] **Step 4: Update the launch prompts in `docs/DRY-RUN.md`**

Both prompts become: "Read CLAUDE.md and follow 'Launcher session'. Run writing-plans on docs/PROBLEM.md and docs/DECISIONS.md into docs/PLAN.md, dispatch product for docs/SPEC.md, then start the orchestrator as the launcher section says. Do not ask me anything." Add the line "Recovery: start any session with `RESUME`; the launcher section handles it."

- [ ] **Step 5: Remove the inert Stop hook**

Delete the `"Stop": [...]` block from `.claude/settings.json` and `git rm .claude/hooks/ledger-check.sh`.

- [ ] **Step 6: Verify**

```bash
jq -e '.hooks.Stop == null' .claude/settings.json
test ! -e .claude/hooks/ledger-check.sh
grep -q '30x-watchdog' CLAUDE.md && grep -q 'sync.sh' .claude/agents/orchestrator.md && grep -q 'run_status.py' .claude/agents/orchestrator.md
bash scripts/tests/run.sh
```
Expected: every command exits 0.

- [ ] **Step 7: Commit**

`git add -A CLAUDE.md .claude/agents/orchestrator.md docs/DRY-RUN.md .claude/settings.json .claude/hooks/ledger-check.sh && git commit -m "harness: launcher-owned watchdog routine, RESUME from origin, drop inert Stop hook"`

---

### Task 5: Orchestrator overrides for preloaded skills (F3, F12)

**Files:**
- Modify: `.claude/agents/orchestrator.md` (new section "Overrides to preloaded skills (these win)", placed right after "Step 0")
- Modify: `CLAUDE.md` (one line at the end of "Autonomy")

**Interfaces:** none (prompt only).

- [ ] **Step 1: Write the override section, one bullet each**

- **Pre-authorised actions:** merge a task branch into `integration`, and `integration` into `main` once the full suite and QA happy path pass. Also push through `sync.sh`, run `wrangler deploy` and run `bash scripts/db-push.sh`. Where `subagent-driven-development` lists "a merge, a push to a shared branch, a publish" as stop-and-ask, do it and write a ledger line.
- **`finishing-a-development-branch`:** never present the menu and never wait. Always take option 1, merge locally. The base is `integration` for a `task/*` branch and `main` for `integration`. Then run `bash scripts/sync.sh`.
- **Budgets:** the CLAUDE.md caps of 2 builder attempts, 2 reviewer passes, 2 QA runs and 2 rulings replace "Fix round R of 5".
- **Ledger:** `docs/LEDGER.md` is the only ledger. `.superpowers/sdd/` holds scratch briefs and review packages, and RESUME never reads it.
- **Foreground dispatch:** dispatch builders, reviewer, QA and product with `run_in_background: false`. Background dispatch is allowed only for independent tasks started in parallel, and you wait for every one before your turn ends.
- **What still stops you:** only the CLAUDE.md hard stops. Everything else gets a ruling.

- [ ] **Step 2: Add the CLAUDE.md line**

"Any preloaded skill that says stop and ask, or wait, before a merge, push, deploy or migration is overridden by this section and by the orchestrator's override list."

- [ ] **Step 3: Verify**

Run: `grep -c 'Overrides to preloaded skills' .claude/agents/orchestrator.md && grep -q 'run_in_background: false' .claude/agents/orchestrator.md && grep -q 'overridden by this section' CLAUDE.md`
Expected: `1`, then exit 0.

- [ ] **Step 4: Commit**

`git add .claude/agents/orchestrator.md CLAUDE.md && git commit -m "harness: orchestrator overrides stop-and-ask, fix-round and ledger rules of preloaded skills"`

---

### Task 6: Lint feedback reaches the agent (F6)

**Files:**
- Modify: `.claude/hooks/lint-file.sh`
- Create: `scripts/tests/lint-hook.test.sh`
- Modify: `CLAUDE.md:79` and the "Code rules" section

**Interfaces:**
- Produces: the hook contract. It reads `.tool_input.file_path`. It resolves `ROOT` as the git toplevel of the file's own directory, which keeps it correct inside worktrees.
  - **`.ts`, `.tsx`, `.js`, `.jsx`:** runs `$ROOT/node_modules/.bin/eslint --no-warn-ignored <file>` from `$ROOT`, but only if `$ROOT/eslint.config.*` exists and that binary is executable.
  - **`.py`:** runs `ruff check <file>` if ruff is on PATH.
  - **Lint fails:** prints the last 30 lines to stderr and exits 2. Everything else exits 0 silently.

- [ ] **Step 1: Write the failing test `scripts/tests/lint-hook.test.sh`**

Setup: a temp git repo with `src/x.ts`. The stub `node_modules/.bin/eslint` prints `1 error: no-unused-vars` and exits 1. The helper `run() { echo "{\"tool_input\":{\"file_path\":\"$1\"}}" | bash "$ROOT/.claude/hooks/lint-file.sh"; }`.
```bash
run "$T/src/x.ts" 2>err; test $? -eq 0; test ! -s err      # no eslint.config.* yet: silent
touch "$T/eslint.config.js"
run "$T/src/x.ts" 2>err; test $? -eq 2; grep -q 'no-unused-vars' err
run "$T/README.md" 2>err; test $? -eq 0
printf '#!/bin/sh\nexit 0\n' > "$T/node_modules/.bin/eslint"
run "$T/src/x.ts" 2>err; test $? -eq 0; test ! -s err
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/tests/lint-hook.test.sh`
Expected: FAIL at the exit-2 assertion, because the current hook always exits 0.

- [ ] **Step 3: Rewrite `.claude/hooks/lint-file.sh` to the contract above**

- [ ] **Step 4: Update CLAUDE.md**

Line 79: "PostToolUse on Edit/Write: lint the touched file; errors go back to the agent (exit 2). Silent until the product has `eslint.config.js` and eslint installed." Under "Code rules", add: "The first product task scaffolds `package.json` with `lint`, `typecheck` and `test` scripts and an `eslint.config.js`."

- [ ] **Step 5: Run tests to verify they pass**

Run: `bash scripts/tests/run.sh`
Expected: exit 0.

- [ ] **Step 6: Commit**

`git add .claude/hooks/lint-file.sh scripts/tests/lint-hook.test.sh CLAUDE.md && git commit -m "harness: lint hook feeds errors back with exit 2, silent without config"`

---

### Task 7: Ponytail reaches every agent that writes or judges code (F8)

**Files:**
- Modify: `.claude/agents/reviewer.md` (add `ponytail` to `skills:`)
- Modify: `CLAUDE.md:69,78`

**Interfaces:** none.

- [ ] **Step 1: Add `ponytail` to the reviewer's `skills:` list.** Step 0 of the reviewer prompt quotes a heading from each of its three skills.

- [ ] **Step 2: Correct the CLAUDE.md claim**

Lines 69 and 78 say that the guarantee is the `skills:` preload of `ponytail` in both builders and the reviewer. SubagentStart injection is best effort, and subagents did not receive it in the 15 Oct probe.

- [ ] **Step 3: Verify with a probe dispatch**

Dispatch `reviewer` with: "Capability probe only. Quote one heading from each skill whose full text is in your context at startup." Expected: headings from `requesting-code-review`, `ponytail-review` and `ponytail`.

- [ ] **Step 4: Commit**

`git add .claude/agents/reviewer.md CLAUDE.md && git commit -m "harness: preload ponytail into reviewer; document injection as best effort"`

---

### Task 8: Supabase setup as code, plus readiness warnings (F9, F10, F11)

**Files:**
- Create: `supabase/migrations/20261015000000_files_bucket.sql`
- Modify: `docs/INFRA.md` (Supabase setup steps 4 and 5)
- Modify: `scripts/preflight.sh` (four WARN lines, no new FAIL)

**Interfaces:**
- Consumes: `scripts/db-push.sh` (existing) and `scripts/run_status.py` (Task 3).

- [ ] **Step 1: Write the migration**

```sql
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
-- down
-- delete from storage.buckets where id = 'files';
```

- [ ] **Step 2: Apply it and turn off email confirmation**

```bash
bash scripts/db-push.sh
curl -s -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"mailer_autoconfirm":true}'
```
Expected: `applied 20261015000000 files_bucket`, then a JSON auth config containing `"mailer_autoconfirm":true`.

- [ ] **Step 3: Verify live**

```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $SUPABASE_ANON_KEY" | jq -e '.mailer_autoconfirm == true'
curl -s "$SUPABASE_URL/storage/v1/bucket/files" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq -e '.public == false'
```
Expected: `true`, `true`.

- [ ] **Step 4: Add the four WARN lines to `scripts/preflight.sh`**

- **In the Supabase block:** WARN `Confirm email is on: QA cannot sign up users (INFRA.md Supabase step 4)` when `.mailer_autoconfirm` is not true.
- **In the Supabase block:** WARN `storage bucket 'files' missing: bash scripts/db-push.sh` when the bucket GET is not 200.
- **In the Resend block:** WARN `RESEND_FROM is @resend.dev: mail reaches only the Resend sign-up address; verify a domain before any AC emails other people` when `RESEND_FROM` ends in `@resend.dev`.
- **In a new `== Clock` block:** WARN `DEADLINE not set in docs/CONTEXT.md; agents assume 2026-10-18T12:00-05:00` when `python3 scripts/run_status.py` prints `(default)`.

- [ ] **Step 5: Update `docs/INFRA.md`**

Step 4 gives the PATCH command above. Step 5 says the bucket comes from migration `20261015000000_files_bucket.sql`.

- [ ] **Step 6: Run preflight**

Run: `bash scripts/preflight.sh`
Expected: `PREFLIGHT PASSED`, with WARN lines only for the Resend sender, the deadline, pooler TCP and AWS. No WARN for Confirm email or the bucket.

- [ ] **Step 7: Commit**

`git add supabase/migrations/20261015000000_files_bucket.sql docs/INFRA.md scripts/preflight.sh && git commit -m "infra: files bucket migration, autoconfirm documented, readiness warnings in preflight"`

---

### Task 9: First live deploy with Worker secrets (F4)

**Files:**
- Create on `main`: `scripts/worker-secrets.sh`
- On branch `dryrun/deploy`, created from `main` and never merged: `src/index.ts`, `supabase/migrations/20261015000100_dryrun_ping.sql`, `supabase/migrations/20261015000200_drop_dryrun_ping.sql`

**Interfaces:**
- Produces: `bash scripts/worker-secrets.sh`. For each name in `RESEND_API_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_POOLER_URL TYPESAFE_API_KEY ANTHROPIC_API_KEY` that is non-empty in env, it runs `printf %s "${!n}" | npx -y wrangler secret put "$n"`. It prints `secret <name>: ok|failed` and never echoes values. Run it after the first `wrangler deploy`.
- Produces: the deployed URL `https://30x-hackathon.<subdomain>.workers.dev`, recorded in `docs/LEDGER.md` on `main`.

- [ ] **Step 1: Create `scripts/worker-secrets.sh` on `main` and commit it**

`git add scripts/worker-secrets.sh && git commit -m "infra: worker-secrets.sh pushes session env secrets to the Worker"`

- [ ] **Step 2: Branch and write the throwaway migration**

`git checkout -b dryrun/deploy`. The `dryrun_ping` migration creates `public.dryrun_ping(id int primary key, note text)`, enables RLS, adds policy `anon read` for `select` to `anon` using `(true)`, runs `grant select on public.dryrun_ping to anon`, and inserts `(1, 'hola')`. It ends with a `-- down` block. The drop migration is `drop table public.dryrun_ping;` with its own `-- down`.

- [ ] **Step 3: Write `src/index.ts`, with no dependencies**

`export default { async fetch(req: Request, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }): Promise<Response> }`.

`GET /api/health` fetches `${env.SUPABASE_URL}/rest/v1/dryrun_ping?select=id` with header `apikey: env.SUPABASE_ANON_KEY` and returns `Response.json({ ok: true, rows: <array length> })`. Any other path returns 404.

- [ ] **Step 4: Push the first migration only, deploy and set secrets**

```bash
mv supabase/migrations/20261015000200_drop_dryrun_ping.sql /tmp/ && bash scripts/db-push.sh
mkdir -p dist && echo '<!doctype html><title>30x</title><p>ok</p>' > dist/index.html
npx -y wrangler deploy
bash scripts/worker-secrets.sh && npx -y wrangler secret list
```
Expected:
- `applied 20261015000100 dryrun_ping`
- the deploy prints the workers.dev URL
- each secret reports `ok`, and the list shows the three required names

If deploy fails because no workers.dev subdomain is registered, log it as Roberto action R2 and stop this task.

- [ ] **Step 5: Verify live**

Run: `curl -s https://30x-hackathon.<subdomain>.workers.dev/api/health && curl -s -o /dev/null -w '%{http_code}\n' https://30x-hackathon.<subdomain>.workers.dev/`
Expected: `{"ok":true,"rows":1}`, then `200`.

- [ ] **Step 6: Apply the drop migration, verify, clean up and commit**

```bash
mv /tmp/20261015000200_drop_dryrun_ping.sql supabase/migrations/ && bash scripts/db-push.sh
curl -s https://30x-hackathon.<subdomain>.workers.dev/api/health   # rows no longer 1: table gone
```
Delete the two dry-run version rows through the Management API query endpoint, so the history matches `main`: `delete from supabase_migrations.schema_migrations where version in ('20261015000100','20261015000200')`.

`git add -A src supabase && git commit -m "dryrun: hello worker reading Supabase, ping migrations"`, then `git push -u origin dryrun/deploy`.

Switch to `main`, append the URL and the results to `docs/LEDGER.md`, and commit with `docs: first live deploy verified`.

---

### Task 10: End-to-end dry run with kill and RESUME (F4)

**Files:**
- On branch `dryrun/e2e`, created from `main` after Tasks 1 to 9: `docs/PROBLEM.md`, `docs/DECISIONS.md`, and the `DEADLINE:` line in `docs/CONTEXT.md`
- On `main` at the end: `docs/DRY-RUN.md` (append "Results 2026-10-15")

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Fill the fake company on `dryrun/e2e`**

The fake company is a LATAM logistics firm whose dispatchers assign deliveries in WhatsApp and lose track (from DRY-RUN.md). Write it in Spanish. "Working on Monday" is one sentence. Set `DEADLINE:` to launch time + 8h, with offset -05:00, so FREEZE begins 2h in. Commit and push the branch.

- [ ] **Step 2: Launch the run**

Get the `30x-hackathon` environment id with `list_environments`. Then call `create_session` with:
- `source_url` `https://github.com/Robertzu43/30x-hackathon-roberto-zuniga`
- `source_revision` `dryrun/e2e`
- `prompt` set to the Task 4 launch prompt, prefixed with: "DRY RUN: branch dryrun/e2e plays the role of main. Never push to or merge into main."

- [ ] **Step 3: Wait for one finished task, then kill**

Wait until `git fetch origin && git show origin/integration:docs/LEDGER.md` shows at least one task done line. Then `archive_session` the run. Also exercise the liveness rule once with a fresh container (for example by letting the session go idle until it is reclaimed, then firing its Routine with `fire_trigger`): the launcher must see no live orchestrator and dispatch RESUME.

- [ ] **Step 4: Resume**

Run `list_triggers` and delete that session's `30x-watchdog`. Then `create_session` with the same source and the prompt `DRY RUN as above. RESUME`. Expected: the ledger shows `RESUMED at <task>`, and no task that already has a done line is redone.

- [ ] **Step 5: Let it run through FREEZE, then check every item**

Each item cites evidence in the form of a command and its output:
- heartbeat email received
- ledger has rulings
- worktrees were used, shown by branch list
- tests ran in each builder report
- QA saw no briefs
- debate rounds counted, even if 0
- ledger merges had no conflicts
- lint errors reached a builder, or there were no lint errors
- no stop-and-ask in either transcript, shown by `list_events` with kinds `assistant` and `result`
- FREEZE obeyed after T-6h
- the Routine fired hourly

- [ ] **Step 6: Record and stop**

On `main`, append the checklist with its results to `docs/DRY-RUN.md` and commit with `docs: dry run results`. Run `bash scripts/sync.sh`. Delete the dry-run `30x-watchdog` and archive the session.

- [ ] **Step 7 (Roberto confirms; hard stop): clean the slate for kickoff**

Get Roberto's confirmation, then:
- Push `integration` and `task/*` to `dryrun-archive/*` names and delete them on origin, so the real run's `git checkout integration` cannot pick up dry-run work.
- Drop the dry run's product tables from the hackathon Supabase project, and delete their `schema_migrations` rows.

---

### Roberto actions (manual, outside the agents)

- **R1 (F10):** in Resend, add and verify a domain you control (SPF, DKIM, DMARC). Set `RESEND_FROM=notificaciones@<domain>` in the environment variables and in `wrangler.toml [vars]`. Until then, only `HEARTBEAT_EMAIL` receives mail.
- **R2 (only if Task 9 Step 4 reports it):** register a workers.dev subdomain in the Cloudflare dashboard under Workers & Pages.
- **R3 (F11, at kickoff):** write the `DEADLINE:` line in `docs/CONTEXT.md`, and paste the rubric into the same file.
