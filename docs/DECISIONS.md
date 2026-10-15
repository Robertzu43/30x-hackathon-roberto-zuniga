# Decisions (Roberto only)
DRY RUN, 15 Oct 2026: fake company (see PROBLEM.md). Scope is deliberately small so the run finishes in a few hours.

## Stack
Cloudflare Workers (compute, deploy, KV cache) + Supabase (Postgres, Auth, Storage) + Resend (email) + Workers AI (Cloudflare-hosted open models, free tier) for LLM features, no Anthropic key. D1/R2 not used. AWS connected via Agent Toolkit (new AWS experience, project Region us-east-2) as an available resource for S3/SES/AI services when an AC needs them; not the default.

## Scope: in
- Dispatcher web (laptop): upload the day's CSV with a preview-then-confirm step, see today's deliveries, assign each one to a courier, reassign at any time, see status and failure reason per delivery.
- Courier web (phone): log in, see my deliveries for today, mark each one entregado or fallido with a reason (no estaba / dirección errada / rechazado / otro).
- End-of-day view for the dispatcher: counts of entregado / fallido / pendiente and the failed list with reasons.
- `/demo` page with seeded Spanish data: 2 couriers, 12 deliveries in mixed statuses, demo credentials shown on the page.
- SHOULD, only after every MUST passes QA: email the end-of-day summary to the dispatcher at 6pm Bogotá (Resend, Worker cron trigger).

## Scope: out (explicitly)
- WhatsApp integration, maps and routing, customer-facing tracking, payments, photo proof of delivery, multi-company, courier self-registration.
- No LLM feature is required. A builder who wants one writes it in docs/IDEAS.md.

## Product decisions
- D1: Auth is Supabase email + password. A `profiles` table holds the role: dispatcher or courier. No sign-up page; the seed creates the users. Credentials for the demo go in README and on `/demo`.
- D2: CSV import shows a preview; rows missing telefono or direccion are listed and skipped, never block the valid rows. Duplicate `pedido` for the same day is skipped too.
- D3: Statuses: pendiente -> asignado -> entregado | fallido. The dispatcher can reassign a fallido or asignado delivery, which puts it back to asignado.
- D4: "Today" is the America/Bogota date. Deliveries belong to a date; history stays in the database.
- D5: Phone numbers stored in E.164 (+57...). Money in COP without decimals. Dates shown dd/mm/yyyy.
- D6: One Worker, one URL. Dispatcher at `/`, courier at `/mensajero`, demo at `/demo`, API under `/api/*`.

## Mentor feedback incorporated
- none (dry run)

## Check-in cadence
Dry run: Roberto only reads the heartbeat emails. Clock for this run: treat the upload deadline as 2026-10-16T08:00Z (feature freeze at T-6h = 02:00Z, shutdown at T-2h = 06:00Z). The real deadline goes in docs/CONTEXT.md at kickoff.
