#!/usr/bin/env bash
[ -f .env ] && { set -a; . ./.env; set +a; }  # local laptop: load .env (gitignored); cloud session: env config instead
# Apply supabase/migrations/*.sql in order through the Supabase Management API (HTTPS). Works where Postgres ports are
# closed (the cloud sandbox). Records each version in supabase_migrations.schema_migrations, same table the CLI uses.
set -u
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}" "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}"
API="https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query"
q(){ printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps({"query":sys.stdin.read()}))' > /tmp/dbq.body
     curl -s -o /tmp/dbq.json -w "%{http_code}" -X POST "$API" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @/tmp/dbq.body; }
okc(){ [ "$1" = 200 ] || [ "$1" = 201 ]; }
c=$(q "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);")
okc "$c" || { echo "FAIL init ($c): $(head -c 200 /tmp/dbq.json)"; exit 1; }
c=$(q "select version from supabase_migrations.schema_migrations order by version;"); okc "$c" || { echo "FAIL read versions ($c)"; exit 1; }
applied=$(python3 -c 'import json;print(" ".join(r["version"] for r in json.load(open("/tmp/dbq.json"))))')
n=0
for f in supabase/migrations/*.sql; do
  [ -e "$f" ] || { echo "db-push: no migrations in supabase/migrations"; exit 0; }
  v=$(basename "$f" | cut -d_ -f1); name=$(basename "$f" .sql | cut -s -d_ -f2-)
  case " $applied " in *" $v "*) continue;; esac
  # one HTTP call = one implicit transaction: if any statement fails nothing is applied, including the version row
  c=$(q "$(cat "$f")
insert into supabase_migrations.schema_migrations(version, name) values ('$v', '${name//\'/\'\'}');")
  okc "$c" && { echo "applied $v $name"; n=$((n+1)); } || { echo "FAIL $v $name ($c): $(head -c 300 /tmp/dbq.json)"; exit 1; }
done
echo "db-push done: $n applied, $(echo $applied | wc -w | tr -d ' ') already there"
