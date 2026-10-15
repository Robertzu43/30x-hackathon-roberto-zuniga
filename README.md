# 30X Hackathon harness

An autonomous agent team (product, orchestrator, senior/junior builders, reviewer, QA) that turns a company's operational problem into a deployable product over a weekend. Roberto writes `docs/PROBLEM.md` and `docs/DECISIONS.md`; the agents do the rest and record every decision in `docs/LEDGER.md`.

This README is replaced by the product once there is a product. Until then, start with `CLAUDE.md`.

## Run it anywhere
1. Clone. Copy `.env.example` to `.env` and fill it, or set the same variables in the session environment (cloud). Secrets never go in git.
2. Preflight must print `PREFLIGHT PASSED`; the orchestrator runs it first in every cloud session, so nobody runs it by hand.
3. Open Claude Code at the repo root. Agents, hooks and skills load from `.claude/`; nothing to install. Pipeline and rules: `CLAUDE.md`. Launch command and dry run: `docs/DRY-RUN.md`.
