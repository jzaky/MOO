#!/usr/bin/env bash
# Creates local development/test databases and roles. Requires a local
# PostgreSQL superuser (run as the `postgres` OS user or with PGUSER set).
set -euo pipefail
psql=${PSQL:-"psql -v ON_ERROR_STOP=1"}
$psql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'moo_owner') THEN CREATE ROLE moo_owner LOGIN PASSWORD 'moo_owner' CREATEDB; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'moo_runtime') THEN CREATE ROLE moo_runtime NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'moo_app') THEN CREATE ROLE moo_app LOGIN PASSWORD 'moo_app'; END IF;
END $$;
GRANT moo_runtime TO moo_app;
SQL
for db in moo_dev moo_test; do
  if ! $psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    $psql -c "CREATE DATABASE $db OWNER moo_owner"
  fi
done
echo "Databases ready: moo_dev, moo_test"
