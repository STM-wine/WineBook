#!/usr/bin/env python3
"""Disposable PostgreSQL regression harness. Never connects to the configured Supabase project.

Uses the installed PostgreSQL binaries. Auth UID and scheduler stand-ins permit
business-schema tests without Docker; this does not exercise GoTrue or Realtime.
Every database and process created here is temporary. Logs survive in tmp/performance.
"""
from pathlib import Path
import getpass
import json
import re
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tmp/performance/database"
OUT.mkdir(parents=True, exist_ok=True)
BIN = Path(subprocess.check_output(["pg_config", "--bindir"], text=True).strip())
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    port = str(listener.getsockname()[1])
USER = getpass.getuser()
SHIM = """
create schema auth; create schema storage; create schema extensions; create schema vault; create schema cron;
create table auth.users(id uuid primary key, aud text, role text, email text, encrypted_password text,
 email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create table storage.buckets(id text primary key, name text, public boolean);
create table cron.job(jobid bigint,jobname text);
create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
create function cron.unschedule(bigint) returns boolean language sql as $$ select true $$;
create table vault.decrypted_secrets(name text, decrypted_secret text);
create publication supabase_realtime;
"""


def sql(database, text, log_name, required=True):
    with (OUT / log_name).open("a") as log:
        result = subprocess.run([str(BIN / "psql"), "-X", "-h", "127.0.0.1", "-p", port, "-U", USER,
                                 "-d", database, "-v", "ON_ERROR_STOP=1"], input=text, text=True, stdout=log, stderr=log)
    if required and result.returncode:
        raise RuntimeError(f"SQL failed: {OUT / log_name}")
    return result.returncode == 0


results = {}
with tempfile.TemporaryDirectory(prefix="winebook-performance-pg-") as directory:
    directory = Path(directory)
    data = directory / "data"
    with (OUT / "postgres.log").open("w") as log:
        subprocess.run([str(BIN / "initdb"), "-D", str(data), "-A", "trust", "-U", USER], stdout=log, stderr=log, check=True)
    started = False
    try:
        subprocess.run([str(BIN / "pg_ctl"), "-D", str(data), "-l", str(OUT / "postgres.log"), "-o",
                        f"-p {port} -h 127.0.0.1 -k {directory}", "start"], capture_output=True, check=True)
        started = True
        sql("postgres", "create role anon; create role authenticated; create role service_role bypassrls;", "roles.log")
        for name in ("baseline", "repair_only", "current"):
            sql("postgres", f"create database {name};", "roles.log")
            (OUT / f"{name}-schema.log").write_text("")
            sql(name, SHIM, f"{name}-schema.log")
            count = 0
            for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
                repair = migration.name == "20260926200000_preserve_deleted_catalog_price_audit.sql"
                if name != "current" and migration.name >= "20260926170000" and not (name == "repair_only" and repair):
                    continue
                source = re.sub(r"create extension if not exists (?:pg_net|pg_cron|supabase_vault)[^;]*;",
                                "-- Scheduler extension replaced by no-op local fixture.", migration.read_text(), flags=re.I)
                sql(name, source, f"{name}-schema.log")
                count += 1
            results[f"{name}_migrations"] = count
            if name == "repair_only":
                repair_sql = (ROOT / "supabase/migrations/20260926200000_preserve_deleted_catalog_price_audit.sql").read_text()
                results["repair_only_reapply_audit_fix"] = sql(name, repair_sql, f"{name}-schema.log")
            for test in ("multi_buyer_safety", "add_wine_pricing_integrity", "performance_read_models", "performance_po_reads", "performance_ordering_publication"):
                if name != "current" and test.startswith("performance_"):
                    continue
                logfile = f"{name}-{test}.log"
                (OUT / logfile).write_text("")
                results[f"{name}_{test}"] = sql(name, (ROOT / f"supabase/tests/{test}.sql").read_text(), logfile, required=False)
    finally:
        if started:
            subprocess.run([str(BIN / "pg_ctl"), "-D", str(data), "stop", "-m", "fast"], capture_output=True, check=True)
(OUT / "results.json").write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
raise SystemExit(0 if all(value for key, value in results.items() if key.startswith(("current_", "repair_only_"))) else 1)
