# Decisions (Roberto only)

## Stack
Cloudflare Workers (compute, deploy, KV cache) + Supabase (Postgres, Auth, Storage) + Resend (email) + Workers AI (Cloudflare-hosted open models, free tier) for LLM features, no Anthropic key. D1/R2 not used. AWS connected via Agent Toolkit (new AWS experience, project Region us-east-2) as an available resource for S3/SES/AI services when an AC needs them; not the default.

## Scope: in
-

## Scope: out (explicitly)
-

## Product decisions
- D1:
- D2:

## Mentor feedback incorporated
- <time>: <mentor>, <what changed>

## Check-in cadence
<when Roberto will look at the phone>
