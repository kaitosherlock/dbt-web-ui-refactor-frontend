# dbt-core 1.x parity — Codex plan

Goal: dbt-runner + UI cover the full dbt-core 1.x CLI surface and the major
adapters, without moving to dbt v2 (warm workers need `dbtRunner`, and
Oracle/Dremio/Spark exist only as 1.x Python plugins).

Run phases in order; one Codex session per phase; review + test between phases.

**SCOPE: BACKEND ONLY (dbt-runner/).** Nothing under `nextjs/` is touched —
no UI, no Prisma schema/migrations. Every "Frontend:" item below becomes an
API/service endpoint only, and the frontend work is listed as a follow-up.
Consequences:
- Phase 2 (run-history enum) is **deferred**: the `run_command` enum is owned
  by Prisma migrations in `nextjs/prisma`. Until then the backend keeps mapping
  unknown commands to `run`.
- Phase 5 adapters are complete in the backend but not selectable in
  `ConnectionDialog.tsx` until the frontend follow-up.

## Rules for every phase (prepend to each prompt)

```
Read CLAUDE.md at the repo root first and follow it — it is the contributor
guide (Key decisions, Gotchas, Don't). Scope: only what this phase asks.
Match surrounding code style and comment density. Every behaviour change gets
a test. Before finishing run:
  cd dbt-runner && uv run pytest -q
Do not touch nextjs/ (backend-only scope).
Report: files changed, tests added, anything skipped and why.
```

## Model choice

| Phase | Model | Effort | Why |
|---|---|---|---|
| 0 Security: path flags | gpt-5.6-sol | high | security, subtle parsing |
| 1 Upgrade dbt 1.10 → latest 1.x | gpt-5.6-sol | high | cross-package version resolution, regressions |
| 2 Run-history enum | gpt-5.6-terra | medium | mechanical, Prisma + SQL enum |
| 3 State / defer / retry / clone | gpt-5.6-sol | high | new storage layout, scheduler, design |
| 4 Command UX (ls, debug, run-operation, vars…) | gpt-5.6-terra | medium | forms following existing patterns |
| 5a First new adapter (Snowflake) | gpt-5.6-sol | high | sets the template for all others |
| 5b Remaining adapters | gpt-5.6-terra | medium | copy the 5a template |
| 6 Packages / tests UI, semantic & exposures | gpt-5.6-terra | medium | read artifacts, UI |
| Review after each phase | gpt-5.6-sol | high | adversarial review of diff |

---

## Phase 0 — Block path flags in dbt commands (security)

```
Problem: dbt-runner/app/routers/sse.py (around line 355) builds a dbt argv from
client input with shlex and strips only --profiles-dir. A client can still pass
--project-dir, --target-path, --log-path, --state, --packages-install-path
etc. pointing at another project's directory under STORAGE_DIR (cross-tenant
read/write). dbt_service.run_command (~line 1024) and every endpoint that
accepts additional_args (compile/preview/explain/query) share the same risk.

Do:
1. One helper in dbt-runner (e.g. app/services/command.py) that takes the argv
   and: (a) allows only known dbt subcommands: run test build seed snapshot
   compile show docs deps clean source parse ls list debug run-operation retry
   clone; refuses init (it has its own endpoint); (b) refuses, with a 400 and
   a clear message, any flag whose value is a filesystem path:
   --project-dir --profiles-dir --target-path --log-path --state
   --packages-install-path --defer-state, in both "--flag v" and "--flag=v"
   forms. Server-owned values (profiles-dir, and later state) are appended by
   the server after validation.
2. Use it on every path that turns client text into dbt argv (SSE, /command,
   compile, preview, explain, query, scheduler).
3. Tests: each refused flag in both forms, an unknown subcommand, and that a
   normal `run --select x --full-refresh` passes unchanged.
```

## Phase 1 — Upgrade to the latest dbt-core 1.x

```
dbt-runner/pyproject.toml pins dbt-core==1.10.16 and dbt-postgres, dbt-duckdb,
dbt-oracle, dbt-dremio, dbt-spark at 1.10.x, plus dbt-charts.

Do:
1. Find the highest dbt-core 1.x minor (1.11 or 1.12) for which EVERY bundled
   adapter has a compatible release (check PyPI metadata; adapters declare a
   dbt-core / dbt-adapters range). If one adapter lags, stop at the highest
   minor all support and report which adapter blocked.
2. Update pins + uv.lock (uv lock), keep --frozen working.
3. Check dbt_worker_process.py (dbtRunner usage), log/event parsing,
   run_results/manifest parsing in dbt_service.py against the new version's
   changelog; fix breakages.
4. Run the full test suite; add a smoke test that parses the demo/sample
   project with the new version if none exists.
5. Report deprecation warnings new versions emit on the sample project.
```

## Phase 2 — Run history records the real command

```
dbt_service.py (~line 1267) maps any command outside
{run,test,build,compile,docs,deps,clean,seed,snapshot,source_freshness} to
"run", so parse / ls / debug / run-operation / retry / clone show up as "run"
in History. The enum is Prisma `RunCommand` (nextjs/prisma/schema.prisma,
@@map("run_command")) and a Postgres enum used via CAST(:command AS run_command).

Do: add parse, ls, debug, run_operation, retry, clone to the Prisma enum with a
migration (npx prisma migrate dev --name run_command_more && npx prisma
generate), map CLI names (ls/list → ls, run-operation → run_operation) in one
place in the backend, update every frontend place that switches on the enum
(labels, filters, icons). Tests on both sides.
```

## Phase 3 — State, defer, retry, clone

```
Nothing stores production artifacts today, so state:modified, --defer,
dbt retry and dbt clone cannot work.

Design (keep it this way unless you find a blocker, then report):
- After a SUCCESSFUL run of a schedule (RunScheduler) or a run explicitly on a
  non-dev target, copy target/manifest.json (and run_results.json) to
  STORAGE_DIR/state/{project_id}/{target}/ atomically (write tmp + rename).
- The server — never the client — appends --state <that dir> (and --defer /
  --favor-state when requested) via the Phase 0 helper. Client sends only
  booleans: defer, favor_state, state_target.
- dbt retry: runs in the project dir using the last run's run_results.json in
  target/; expose POST that starts it via run_launcher.py.
- dbt clone: requires state; same flag handling.
- Frontend: in the run menu add "Build modified (state:modified+)", "Defer to
  <target>" toggle, "Retry failed" button on a failed run in History, "Clone
  from <target>". Disable with a tooltip when no state exists for that target.
- Clean up state dirs when a project or target is deleted.
Tests: state copy only on success, flags appended server-side, retry/clone
refused with a message when no state, deletion cleanup.
```

## Phase 4 — Command UX for the rest of the CLI

```
Terminal can run these, but there is no UI. Add, following existing patterns
in DevelopLayout.tsx / RightPanel and buildDbtCommandWithArgs
(nextjs/src/lib/dbt-command-args.ts — the ONLY place --target is appended):
- --vars: key/value editor → valid YAML/JSON arg, for run/build/test/seed/
  snapshot/compile/show/run-operation.
- --empty and --sample (1.10+) toggles for run/build.
- --full-refresh also for seed (COMMANDS_WITH_FULL_REFRESH).
- Microbatch: --event-time-start / --event-time-end date pickers for run/build.
- --selector: dropdown from selectors.yml if present.
- dbt ls: "List resources" with --resource-type and --output json, shown as a
  table (backend endpoint returning parsed JSON).
- dbt debug: "Test profile" in ProjectSettingsDialog.tsx, output shown inline.
- dbt run-operation: pick a macro from the manifest + args form.
- dbt init: accept an optional starter template; keep --skip-profile-setup.
Tests for arg building (dbt-command-args tests) and new endpoints.
```

## Phase 5a — Adapter template: Snowflake

```
Current adapters: postgresql, duckdb, oracle, dremio, spark. Adding a
warehouse touches, in lockstep (CLAUDE.md "Don't" section):
  dbt-runner/pyproject.toml (dbt-snowflake, same minor as dbt-core)
  dbt-runner/adapters/snowflake.py (BaseAdapter: test connection, list
    schemas/tables/columns, like postgresql.py)
  dbt-runner/adapters/__init__.py registry
  dbt_service.build_adapter_config_from_connection_row (profile output;
    secret via the existing secret env var mechanism, target_secret_env for
    extra targets — never write the secret into profiles.yml)
  host guard: account URL through app/core/host_guard.py
  nextjs/src/components/connections/ConnectionDialog.tsx form
Support password and key-pair auth (private key is the secret; passphrase
optional). Fields: account, user, role, warehouse, database, schema, threads.
Make DuckDB-only features (lakehouse attach, DuckDB resources) stay off for it.
Tests: profile rendering for both auth modes, secret never in the file,
registry and dialog stay in step (add a test that compares the two lists if
none exists). Write a short checklist docs/codex/adding-an-adapter.md from
what you learned — Phase 5b follows it.
```

## Phase 5b — Remaining adapters (one Codex session each)

```
Follow docs/codex/adding-an-adapter.md exactly, as done for Snowflake.
Add: <ADAPTER>. Auth to support: <AUTH>.
```

| Adapter | Package | Auth |
|---|---|---|
| BigQuery | dbt-bigquery | service-account JSON (secret), OAuth off |
| Databricks | dbt-databricks | PAT; http_path, catalog |
| Redshift | dbt-redshift | password; IAM optional later |
| Trino / Starburst | dbt-trino | password / JWT; catalog |
| SQL Server | dbt-sqlserver | SQL auth; ODBC driver must be in the image |
| Microsoft Fabric | dbt-fabric | service principal |
| ClickHouse | dbt-clickhouse | password |
| Athena | dbt-athena-community | access key + s3_staging_dir |

Check each package supports the dbt-core minor from Phase 1 before starting;
skip and report one that does not.

## Phase 6 — Artifacts in the UI

```
- packages.yml: panel to search dbt Hub (hub.getdbt.com API, through the
  frontend host guard), add/remove a package with version, then run deps.
  Edit packages.yml as text lines, not a YAML round trip (comments).
- Tests UI: on a model's column, add unique / not_null / accepted_values /
  relationships to its schema YAML (line edit, keep comments); show unit_test
  results separately from data tests in the run view.
- Read semantic_manifest.json (metrics, semantic models, saved queries) and
  manifest exposures; show them in Explore and as nodes in LineageView.
```

## Review prompt (after every phase)

```
Review the changes from the last phase against CLAUDE.md. Look for: security
(host guard, path flags, secrets in files/logs/responses), missed call sites,
frontend/backend enum or registry drift, missing tests, behaviour changes
outside scope. List findings with file:line and severity; fix only the ones
you are confident about, then rerun the test suites.
```
