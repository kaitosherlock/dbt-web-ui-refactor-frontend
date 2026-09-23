# Handover — dbt-core 1.x parity (Codex → Claude)

Codex hit its usage limit during Phase 3 (2026-09-23). Work continues with
Claude subagents. Plan: `docs/codex/dbt-core-1x-parity.md`.

## Rules (unchanged)
- Branch `codex/dbt1-parity`. Subagents do NOT commit/push/switch branch; the
  orchestrator commits after review.
- **Backend only**: never touch `nextjs/`. Frontend work → "follow-ups" list.
- Read `CLAUDE.md` first. Match surrounding style. Every behaviour change has a test.
- Tests: `cd dbt-runner && uv run pytest -q`. `docs/codex/baseline-failures.txt`
  lists failures that exist before this work (Windows box) — do not fix them,
  do not add new ones.

## Done
| Phase | Commit | Notes |
|---|---|---|
| 0 security | d088e5a | `validate_dbt_argv` (app/services/command.py): subcommand allowlist, path flags refused. `app/services/dbt_environment.py`: client/persisted env may not set dbt CLI envvars or PATH/PYTHON*/LD_*; server env inherited unfiltered (keeps DBT_SEND_ANONYMOUS_USAGE_STATS=false). |
| 1 upgrade | 85764c1 | dbt-core 1.10.23. 1.11+ blocked: dbt-dremio 1.10.1 supports only 1.10.x. |
| 2 enum | deferred | Prisma-owned (`nextjs/prisma`), out of scope. |

## In progress — Phase 3 (uncommitted, in working tree, unreviewed)
Codex stopped mid-way; its last visible step was writing `tests/test_dbt_state.py`.
Files: `app/services/state.py` (new), `app/models/dbt.py`, `app/routers/dbt.py`
(retry/clone endpoints), `app/routers/project.py` (cleanup on delete),
`app/services/command.py`, `app/services/dbt_service.py`,
`app/services/run_launcher.py`, `app/services/scheduler.py`,
`tests/test_dbt_state.py` (new). State has NOT been run through the test suite.

## Remaining
3 (finish + verify) → 4 (backend only) → 5a Snowflake → 5b adapters → 6 (backend only).

## Frontend follow-ups collected so far
- Env-var save route should reject the same names as `dbt_environment.py` at save time.
- Phase 2 run_command enum (parse, ls, debug, run_operation, retry, clone).

## MERGE BLOCKER (from Phase 4)
Phase 4 added auth + ownership to /project/*, /process/*, /dbt/init, /dbt/docs/*,
/connection/usage|test|schema. The Next.js proxy forwards browser headers only,
so these plain-fetch callers send no token and will 401 under OIDC
(AUTH_DISABLED=true is unaffected). Fix before merging:
- nextjs/src/app/(app)/develop/page.tsx:48 (/project/delete)
- nextjs/src/components/develop/DevelopLayout.tsx:958 (/process/cancel), :1474 (/project/sync), :1774, :1786 (/project/delete)
- nextjs/src/app/api/dbt-docs/view/[projectId]/route.ts and .../static/[projectId]/[...filePath]/route.ts: forward session.accessToken
Open, needs design: /sse/files/{project_id} has no auth (EventSource cannot send headers).

## Finish plan (user decision 2026-09-23)
Queue: 5a Snowflake → Databricks (user priority) → rest of 5b → 6.
Then: fix ONLY the plain-fetch token calls listed in MERGE BLOCKER (minimal
frontend exception approved by the user; no other UI change), run frontend
tests, then merge codex/dbt1-parity into main locally (no push).

## Worker assignment (user decision 2026-09-23 16:10)
- Backend tasks: Codex CLI again (quota back at 16:10). Opus subagent only as fallback when Codex is out of quota.
- Frontend (after all backend phases): AGY CLI, model gemini-3.8-flash-high, one task per feature
  area, using the "Frontend follow-ups" + endpoint shapes recorded in each phase's commit/report.
- Claude (orchestrator) reviews every result and does the final review before merge to main.
