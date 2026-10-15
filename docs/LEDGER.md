# Ledger

Every task, report, review verdict, QA verdict and ruling. Append only. Written by the orchestrator.

## Infra: first live deploy (15 Oct, harness hardening Task 9)
- URL: https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev (workers.dev certificate went live about 90 s after the first deploy).
- Throwaway Worker from branch `dryrun/deploy`: `GET /api/health` returned `{"ok":true,"rows":1}` from Supabase REST under RLS; `/` served static assets (200); unknown `/api/*` 404.
- Worker secrets set with `scripts/worker-secrets.sh`: RESEND_API_KEY, SUPABASE_POOLER_URL, SUPABASE_SERVICE_ROLE_KEY, TYPESAFE_API_KEY.
- Migrations over HTTPS proven: `20261015000000_files_bucket` applied; dry-run ping table created, read, dropped; its version rows deleted so history matches main.
- The live Worker still runs the dry-run code until the product's first deploy replaces it.
