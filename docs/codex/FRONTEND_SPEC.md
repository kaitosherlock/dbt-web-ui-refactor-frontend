# Frontend spec — UI for backend features on codex/dbt1-parity

Read `CLAUDE.md` first (Next.js 15 App Router; the frontend was just refactored
into `src/common`, `src/entities`, `src/features`, `src/server`, `src/components`
— follow `nextjs/docs/` refactor rules and the import-boundary lint rules).
Match existing components (shadcn/ui, Tailwind). Every browser call to
dbt-runner goes through the shared HTTP client in `src/common/api/client.ts`
(it attaches the session token) — never a bare `fetch` to `/api/dbt-runner`.
Add/extend vitest tests for new pure helpers. `npm run test`, `npx tsc --noEmit`
and `npm run lint` must pass (no new failures vs before your change).
Do not touch `dbt-runner/`.

## F1 — Connections: Databricks + Snowflake, and token on plain fetches

1. Prisma `enum ConnectionType` (`nextjs/prisma/schema.prisma`): add `snowflake`,
   `databricks` + a migration (`ALTER TYPE connection_type ADD VALUE ...`).
2. `ConnectionDialog.tsx`: types, labels, default port 443, form sections, submit
   branches; row shapes in `docs/codex/adding-an-adapter.md` ("Snowflake row
   shape", "Databricks row shape"). Databricks: host (workspace hostname only),
   http_path, auth_type `pat` | `oauth_m2m`, token (PAT) or client_id + client
   secret, catalog (→ `database`), schema, threads. Snowflake: account, user,
   auth_type password|keypair, password or PEM key (+ optional passphrase),
   role, warehouse, database, schema, threads.
   The second secret (`extraConfig.secondary_secret_encrypted`) is encrypted
   exactly like `passwordEncrypted` and **stripped from every response** that
   returns `extraConfig`. Frontend host guard (`host-guard.ts`) on the host.
3. Connection test route (`api/connections/[id]/test/route.ts` or its refactored
   location): map the row to `{host, http_path, auth_type, token?, client_id?,
   client_secret?, catalog?, schema?}` (Databricks) and `{account, user,
   auth_type, password|private_key, private_key_passphrase?, role?, warehouse?,
   database?, schema?}` (Snowflake).
4. Token fix: these callers send no Authorization header and now 401 under OIDC:
   `/project/delete`, `/project/sync/{id}`, `/process/cancel` (develop page +
   DevelopLayout), and the server routes proxying `/dbt/docs/view/{id}` and
   `/dbt/docs/static/{id}/{path}` must forward `session.accessToken`. Find them
   with `grep -rn "project/delete\|project/sync\|process/cancel\|docs/view\|docs/static" src`.
5. Env-var save route: reject names dbt-runner refuses (dbt CLI env vars
   `DBT_*` that are dbt flags e.g. DBT_PROJECT_DIR/DBT_TARGET_PATH/DBT_STATE/
   DBT_PROFILES_DIR/DBT_LOG_PATH; `PATH`, `HOME`, `VIRTUAL_ENV`, `PYTHON*`,
   `LD_*`, `DYLD_*`, `UV_*`; prefix `DBT_ENV_SECRET_DBT_CRAFT_`) with a clear message.

## F2 — Run options, state/defer, retry, clone

Backend fields on `DbtCommand` (`POST /dbt/command`, `/dbt/runs`, SSE body
`/sse/dbt/{id}`): `vars` (object, ≤16 KiB), `empty` (run/build), `sample`
("3 days"; run/build), `event_time_start`/`event_time_end` (ISO, both or none;
run/build), `full_refresh` (run/build/seed), `selector_name`, `state_target`,
`defer` (needs state_target), `favor_state` (needs defer). Conflicting raw
flags in `command` get a 400 — send fields, not flags.
- Run menu / options panel: vars key/value editor, empty + sample, event-time
  pickers, full refresh also for seed, selector dropdown (read `selectors.yml`
  via files API), "Build modified (state:modified+)" and "Defer to <target>"
  using `GET /dbt/state/{project_id}` → `{targets:[{target, manifest,
  run_results, updated_at}]}`; disable with tooltip when a target has no state.
- History: "Retry failed" on a failed run → `POST /dbt/runs/{run_id}/retry`
  `{environment_variables?}` (202; 409 message shown as-is).
- "Clone from <target>" → `POST /dbt/runs/clone` `{project_id, state_target,
  target?, selector?, defer?, favor_state?, environment_variables?}`.
- Deleting/renaming a target must call `DELETE /dbt/state/{project_id}/{target}`.
- Prisma `enum RunCommand` (@@map run_command): add `parse`, `ls`, `debug`,
  `run_operation`, `retry`, `clone` + migration; labels/filters/icons wherever
  the enum is switched on.

## F3 — ls, debug, run-operation, init template

- "List resources": `POST /dbt/ls` `{project_id, select?, exclude?,
  resource_types?, selector_name?, target?, vars?}` → `{success, rows:[{unique_id,
  name, resource_type, package_name, original_file_path, alias, source_name,
  tags, depends_on, config:{materialized, enabled, schema, database}}], count,
  truncated, error}` — table with filter.
- "Test profile" in `ProjectSettingsDialog.tsx`: `POST /dbt/debug`
  `{project_id, target?}` → `{success, target, output}`; show output monospace.
- Macros: `GET /dbt/macros/{project_id}` → `{status, macros:[{unique_id, name,
  package_name, description, arguments, signature:[{name, default}]}]}`;
  run: `POST /dbt/run-operation` `{project_id, macro, args?, target?, vars?}`
  (same response as /dbt/command). Args form built from `signature`.
- Init: `GET /dbt/init/templates` → `{templates, default}`; `POST /dbt/init`
  accepts `template`.
