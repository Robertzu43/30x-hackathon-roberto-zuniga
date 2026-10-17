# Performance (AC-97)

## Row 0: baseline at 17:40Z, before D40

| Measure | Value | Target | Result |
|---|---|---|---|
| `/api/demo/overview`, one request | 2.27 s | p95 under 600 ms | above target |
| JavaScript, one bundle | 626 KB | gzipped under 250 KB | above target |

## Latest run

- Measured at 2026-10-17 18:09 UTC on https://30x-hackathon.30x-hackathon-roberto-zuniga.workers.dev and https://facturas.30x-hackathon-roberto-zuniga.workers.dev.
- Measured from: Cloudflare colo ORD (from `cf-ray`), egress country US (from `/cdn-cgi/trace`). Chromium, 1440x900, a fresh context and empty cache per first load.
- FAILED ROWS: 5

| Screen | Measure | Value | Target | Result |
|---|---|---|---|---|
| login | First load, median of 3 | 784 ms | under 2000 ms | PASS |
| login | JS gzipped before usable | 174 KB | under 250 KB | PASS |
| demo | First load, median of 3 | 686 ms | under 2000 ms | PASS |
| demo | JS gzipped before usable | 174 KB | under 250 KB | PASS |
| inbox | First load, median of 3 | 1022 ms | under 2000 ms | PASS |
| inbox | JS gzipped before usable | 174 KB | under 250 KB | PASS |
| inbox | Navigation to heading or skeleton, median of 3 | 14 ms | within 100 ms | PASS |
| inbox | Navigation to data rendered, median of 3 | 799 ms | under 1000 ms | PASS |
| detail PAGAR | First load, median of 3 | 1295 ms | under 2000 ms | PASS |
| detail PAGAR | Navigation to heading or skeleton, median of 3 | 687 ms | within 100 ms | FAIL |
| detail PAGAR | Navigation to data rendered, median of 3 | 701 ms | under 1000 ms | PASS |
| detail ESCALAR | First load, median of 3 | 1450 ms | under 2000 ms | PASS |
| detail ESCALAR | Navigation to heading or skeleton, median of 3 | 910 ms | within 100 ms | FAIL |
| detail ESCALAR | Navigation to data rendered, median of 3 | 933 ms | under 1000 ms | PASS |
| period | First load, median of 3 | 674 ms | under 2000 ms | PASS |
| period | Navigation to heading or skeleton, median of 3 | 32 ms | within 100 ms | PASS |
| period | Navigation to data rendered, median of 3 | 926 ms | under 1000 ms | PASS |
| beneficiaries | First load, median of 3 | 706 ms | under 2000 ms | PASS |
| beneficiaries | Navigation to heading or skeleton, median of 3 | 17 ms | within 100 ms | PASS |
| beneficiaries | Navigation to data rendered, median of 3 | 345 ms | under 1000 ms | PASS |
| beneficiary | First load, median of 3 | N/A (AC-104 not shipped or no beneficiary) | under 2000 ms | N/A |
| policy | First load, median of 3 | 797 ms | under 2000 ms | PASS |
| policy | Navigation to heading or skeleton, median of 3 | 14 ms | within 100 ms | PASS |
| policy | Navigation to data rendered, median of 3 | 1026 ms | under 1000 ms | FAIL |
| inbox (trial) | First load, median of 3 | N/A (run with --trial (needs the trial door, AC-92)) | under 2000 ms | N/A |
| portal | First load, median of 3 | 729 ms | under 2000 ms | PASS |
| status | First load, median of 3 | N/A (run with --status-token <token>) | under 2000 ms | N/A |
| /api/config (login, demo, inbox, detail PAGAR, detail ESCALAR, period, beneficiaries, policy) | API p95 of 20 | 57 ms | under 600 ms | PASS |
| /api/demo/overview (demo) | API p95 of 20 | 850 ms | under 600 ms | FAIL |
| /api/invoices (inbox) | API p95 of 20 | 299 ms | under 600 ms | PASS |
| /api/agent/last-run (inbox) | API p95 of 20 | 280 ms | under 600 ms | PASS |
| /api/beneficiaries (inbox, beneficiaries) | API p95 of 20 | 275 ms | under 600 ms | PASS |
| /api/portal-link (inbox) | API p95 of 20 | 277 ms | under 600 ms | PASS |
| /api/agent/activity (inbox) | API p95 of 20 | 328 ms | under 600 ms | PASS |
| /api/invoices/310da55f-47ac-4027-832c-27862aae25cb (detail PAGAR) | API p95 of 20 | 448 ms | under 600 ms | PASS |
| /api/invoices/e6e38301-de24-48bc-8e4e-d99a5e3ab87f (detail ESCALAR) | API p95 of 20 | 489 ms | under 600 ms | PASS |
| /api/period?month=2026-10 (period) | API p95 of 20 | 600 ms | under 600 ms | FAIL |
| /api/company (policy) | API p95 of 20 | 264 ms | under 600 ms | PASS |
| /api/policy (policy) | API p95 of 20 | 279 ms | under 600 ms | PASS |
| /api/fx (policy) | API p95 of 20 | 269 ms | under 600 ms | PASS |
| /andina-labs?lang=es (portal) | API p95 of 20 | 258 ms | under 600 ms | PASS |
