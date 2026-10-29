#!/usr/bin/env bash
# Creates local development/test databases and roles. Requires a local
# PostgreSQL superuser (run as the `postgres` OS user or with PGUSER set).
set -euo pipefail
psql=${PSQL:-"psql -v ON_ERROR_STOP=1"}
$psql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stoke_owner') THEN CREATE ROLE stoke_owner LOGIN PASSWORD 'stoke_owner' CREATEDB; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stoke_runtime') THEN CREATE ROLE stoke_runtime NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stoke_app') THEN CREATE ROLE stoke_app LOGIN PASSWORD 'stoke_app'; END IF;
END $$;
GRANT stoke_runtime TO stoke_app;
SQL
for db in stoke_dev stoke_test; do
  if ! $psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    $psql -c "CREATE DATABASE $db OWNER stoke_owner"
  fi
done
echo "Databases ready: stoke_dev, stoke_test"
