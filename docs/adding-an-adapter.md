# Adding a warehouse adapter

The checklist Phase 5b follows. Snowflake (Phase 5a) is the worked example:
every step below names the Snowflake code to copy. Backend steps are 1-9;
steps 10-12 are the frontend follow-up and are listed so the backend sends
exactly what the form will need.

Names used below: `<type>` is the connection type string (`snowflake`), stored
in `connections.connection_type` and used as the registry key.

## 0. Before starting

- Check the dbt plugin supports the pinned dbt-core (1.11.x): `curl -s
  https://pypi.org/pypi/<pkg>/<ver>/json` and read `requires_dist` for
  `dbt-core` / `dbt-adapters`. The tightest constraint today is dbt-databricks
  1.11.8 (`dbt-adapters<1.23`), which is why dbt-postgres stays on 1.10.2 -
  a new plugin must fit inside that range too. Skip and report one that does not.
- Decide the auth modes and, for each, **which value is the secret**. A
  connection row has one secret column (`password_encrypted`) and one optional
  second slot (`extra_config.secondary_secret_encrypted`, see step 4). A mode
  that needs three secrets does not fit - stop and report.
- List the options the profile may carry and the ones it must **never** carry:
  anything that names another host (proxy, OAuth/SSO URL, `authenticator:
  externalbrowser|okta`), reads a server file (`*_path`, keyfile paths), or
  weakens TLS (`insecure_mode`). Snowflake's list is
  `SnowflakeAdapter.PROFILE_OPTION_TYPES` and the comment above it.

## 1. Dependency - `dbt-runner/pyproject.toml`, `uv.lock`

- Add `"<pkg>==<ver>"` next to the other `dbt-*` pins (exact pin).
- `cd dbt-runner && uv lock`, then `uv sync --frozen --extra test`.
- Diff the lock (`name`/`version` pairs) and report every **downgrade** and any
  change to `cryptography`, `pyarrow`, `certifi`, `duckdb`, `sqlalchemy`,
  `dbt-*`. Snowflake downgraded `certifi` 2026.7.22 -> 2025.1.31
  (`dbt-snowflake` caps `certifi<2025.4.26` on every release line) and added
  boto3/keyring/pyopenssl; cryptography 49.0.0 and pyarrow 25.0.0 unchanged.
- The Dockerfile needs nothing unless the driver needs system libraries (ODBC
  for SQL Server: add the `apt-get` packages to both stages).

## 2. Adapter - `dbt-runner/adapters/<type>.py`

Copy `adapters/snowflake.py`. It must:

- Subclass `BaseAdapter`, set `adapter_type = "<type>"`, implement `connect`,
  `disconnect`, `test_connection`, `extract_schema`, `generate_profiles_yml`,
  `_get_schemas`, `_get_tables`, `_get_views`, `_get_columns`.
- **Import nothing from `app`** (CLAUDE.md). Host guard is the caller's job.
- Blocking drivers run in `asyncio.to_thread`; import the driver lazily inside
  the method (`_open`), so importing `adapters` never needs it.
- If the host is *derived* (Snowflake: `<account>.snowflakecomputing.com`),
  expose a pure validator + `..._host()` function (`normalize_account`,
  `account_host`), validate with a strict anchored regex, refuse URLs/`/:@`/
  whitespace with a message that says what to type instead, and **pin the
  derived host** into both the driver call and the profile. Never use a `host`
  a client sent.
- `test_connection` returns `{"success", "message", "details"}` and never
  raises; map the driver's auth / network error codes to short messages; never
  quote a secret (a key-load error says "could not be read", not the PEM).
- Introspection binds every value (`%s` params) and never concatenates an
  identifier. Batch it: one query for relations, one for columns, when every
  statement is a network round trip.
- `generate_profiles_yml` builds a dict and returns `yaml.safe_dump(...)` - not
  an f-string - so a quote/colon/newline in a value stays a value. Refuse
  (`ValueError` subclass) a target dbt cannot run (missing database/schema);
  `_render_target` turns it into a `DbtOperationError` naming the target.
- Whitelist optional profile keys with their types; drop anything else.

## 3. Registry - `dbt-runner/adapters/__init__.py`

- Import the class, add `"<type>": <Class>` to `ADAPTERS`, add the class to
  `__all__`.
- Add `"<type>"` to `PENDING_IN_DIALOG` in
  `tests/test_adapter_registry_drift.py` until the form exists (strict xfail:
  it fails once the dialog has the type and the entry is still there).

## 4. Profile mapping - `app/services/dbt_service.py`

In `build_adapter_config_from_connection_row`, add an `if conn_type ==
"<type>":` branch before the `ducklake` branch (copy the Snowflake one):

- Map row columns: `username` -> user, `database` -> database; everything else
  from `extra_config` (Snowflake: `account`, `auth_type`, `role`, `warehouse`,
  `schema`). `threads` via `_threads(extra_cfg, conn_type)` (it pops; add a
  default to `DEFAULT_THREADS` only if the warehouse needs one).
- Put `secret_value` in the field the auth mode uses (`password`,
  `private_key`, `token`, ...) and return `needs_secret=True`.
- A second secret: put `secondary_secret_value` in its field **only when
  `has_secondary_secret`** (the builder already popped
  `SECONDARY_SECRET_KEY` from `extra_cfg`). Nothing else is needed - the
  env var (`DBT_PROFILE_SECONDARY_SECRET_ENV`, `__<TARGET>` for extra targets),
  the decrypt and the reservation are generic.
- Optional keys: a `<TYPE>_EXTRA_CONFIG_KEYS` tuple copied from
  `extra_cfg` (the adapter type-checks them again). Never spread `**extra_cfg`.

Secret design (do not change per adapter):

| Secret | Stored | Placeholder in profiles.yml | Env var (dev / other target) |
|---|---|---|---|
| main | `connections.password_encrypted` | `DBT_PROFILE_SECRET_PLACEHOLDER` | `DBT_ENV_SECRET_DBT_CRAFT_CREDENTIAL` / `..._CREDENTIAL__PROD` |
| second | `extra_config.secondary_secret_encrypted` (same encryption) | `DBT_PROFILE_SECONDARY_SECRET_PLACEHOLDER` | `DBT_ENV_SECRET_DBT_CRAFT_SECONDARY` / `..._SECONDARY__PROD` |

- `_build_target_config` fills each placeholder with the per-target name
  (`DbtService.target_secret_env(target, base)`) and sets the env only when the
  placeholder was actually placed.
- `app/services/dbt_environment.py` reserves the whole
  `DBT_ENV_SECRET_DBT_CRAFT_` prefix (`DBT_PROFILE_SECRET_PREFIX`): a client or
  persisted env var under it is refused. A new secret name must live under it.
- Direct connections (target check, ingest table picker) call
  `build_adapter_config_with_secrets(row)`, which fills the same slots with the
  decrypted values. Never patch `config["password"]` in afterwards.
- If the profile gains a new credential key, add it to `_REDACTED_PROFILE_KEYS`
  in `app/routers/dbt.py` (the diagnostics preview).

## 5. Host guard - `app/services/connection_targets.py`

- Default: `config["host"]` / `config["port"]` are checked - nothing to do if
  the adapter config carries the real host.
- Derived host: add a branch to `target_endpoint` returning `(host, port)` from
  the adapter's validator, converting its error to `HostNotAllowed`.
- Hostless (local file / session config): add to `HOSTLESS_TYPES` only if it
  truly dials no host.
- Callers already use it: `/connection/test`, `/connection/schema`,
  `_check_targets` (`/check-target`, `/check-connection`), the ingest table
  picker. The frontend's own guard at save time is step 11.

## 6. DuckDB-only features

Nothing to add, but check: `_apply_duckdb_resources` and
`_apply_lakehouse_attach` are gated on `conn_type == "duckdb"`; the "lake with
no DuckDB target" refusal runs **after** the target loop in
`_regenerate_profiles_from_db`, so a non-DuckDB target beside a DuckDB one
still renders. `release_duckdb_file` is DuckDB-only. Covered by
`test_duckdb_only_features_stay_off_for_snowflake_targets` and
`test_a_lake_on_a_snowflake_only_project_is_refused_by_name` - copy both.

## 7. Ingest

A warehouse is neither an ingest source nor a destination by default, and both
refuse with a message: the table picker via `supported_source_types()`
(`ingest/sql_source.py`), loading via `WAREHOUSE_DESTINATIONS`
(`ingest/destination.py`). Supporting either is its own change (a SQLAlchemy
driver in `SOURCE_DRIVERS` + `build_url`; a dlt destination in
`build_destination` + `ingest/runner.py`). Keep the two refusal tests.

## 8. Tests - `dbt-runner/tests/test_<type>_adapter.py`

Copy `tests/test_snowflake_adapter.py` and keep every section:

- host/identifier validation: valid and invalid parametrised lists (URL,
  scheme, port, `@`, path, whitespace, newline, empty labels, overlong);
- registry lists the type; `get_adapter` returns the class;
- host guard: derived host checked (client `host` ignored), invalid value
  refused before the guard, loopback resolution refused, `/connection/test`
  refuses without calling the driver;
- profile per auth mode: secret field is the placeholder; second secret only
  when present; whitelisted options only; YAML injection stays a value;
  unusable target refused; dbt's own credentials class accepts the rendered
  output (`test_rendered_keypair_profile_is_what_dbt_snowflake_accepts`);
- full `_regenerate_profiles_from_db` with the fake session: env holds each
  secret under the per-target names, `profiles.yml` holds none of them;
- DuckDB-only features off; lake refusal names the type;
- adapter methods with the driver mocked: kwargs (host pinned, auth fields),
  success details, error-code mapping, schema extraction, bound parameters;
- `_redact_profiles_yml` masks any new credential key;
- ingest refusals.
- Update `tests/test_profiles_from_connection.py::test_unsupported_connection_type_is_rejected`
  only if it names the new type (it now uses `not_a_warehouse`).

Run `cd dbt-runner && uv run python -m pytest -q -p no:cacheprovider` and diff
the suite must stay green.

## 9. Docs

- Update the Snowflake-specific numbers in this file only if a step changed.
- `README.md` warehouse list and CLAUDE.md only once the UI offers the type.

## 10-12. Frontend follow-up (not in a backend phase)

10. `nextjs/prisma/schema.prisma` `enum ConnectionType`: add `<type>` plus a
    migration (`ALTER TYPE connection_type ADD VALUE '<type>'`). Until then the
    row cannot be saved at all.
11. `ConnectionDialog.tsx`: `ConnectionType` union, `TYPE_LABELS`,
    `DEFAULT_PORTS`, a form section and a `handleSubmit` branch sending the
    row shape of step 4; the frontend host guard (`src/lib/host-guard.ts`) on
    the host the backend derives; the second secret encrypted exactly like
    `passwordEncrypted` and **stripped from every response** that returns
    `extraConfig` to the browser.
12. `src/app/api/connections/[id]/test/route.ts`: a branch mapping the row to
    the adapter config of step 2 (decrypted secrets), then remove `<type>` from
    `PENDING_IN_DIALOG`.

### Snowflake row shape (what the dialog must send)

| Column | Value |
|---|---|
| `connectionType` | `"snowflake"` |
| `host` | `<account>.snowflakecomputing.com` (display + frontend guard; backend derives its own) |
| `port` | `443` |
| `database` | database name (required to run dbt and to browse) |
| `username` | Snowflake user |
| `passwordEncrypted` | password, or the PEM private key for key-pair |
| `extraConfig.account` | account identifier, e.g. `myorg-myaccount`, `xy12345.eu-west-1` (required) |
| `extraConfig.auth_type` | `"password"` (default) or `"keypair"` |
| `extraConfig.role` / `.warehouse` | optional |
| `extraConfig.schema` | required for dbt runs |
| `extraConfig.threads` | optional int (1-32, default 4) |
| `extraConfig.secondary_secret_encrypted` | key-pair passphrase, encrypted; omit for an unencrypted key |
| `extraConfig.query_tag`, `connect_retries`, `connect_timeout` (int), `client_session_keep_alive`, `retry_on_database_errors`, `retry_all`, `reuse_connections` (bool) | optional |

Test route config for `/connection/test` and `/connection/schema`:
`{account, user, auth_type, password | private_key, private_key_passphrase?,
role?, warehouse?, database?, schema?}`.

### Databricks row shape (frontend follow-up)

| Column | Value |
|---|---|
| `connectionType` | `"databricks"` |
| `host` | Workspace hostname only (required): `*.cloud.databricks.com`, `*.azuredatabricks.net`, or `*.gcp.databricks.com`; no scheme, port, path, or query |
| `port` | `443` |
| `database` | Unity Catalog name (optional; omit/empty uses the adapter default catalog) |
| `username` | Empty; Databricks PAT and OAuth M2M do not use it |
| `passwordEncrypted` | Personal access token for `pat`; empty/unused for `oauth_m2m` |
| `extraConfig.auth_type` | `"pat"` (default) or `"oauth_m2m"` |
| `extraConfig.http_path` | Required SQL warehouse path `/sql/1.0/warehouses/<16-character-id>` or cluster path `/sql/protocolv1/o/<workspace-id>/<cluster-id>` |
| `extraConfig.client_id` | OAuth M2M service-principal client ID; required only for `oauth_m2m` |
| `extraConfig.secondary_secret_encrypted` | OAuth M2M client secret, encrypted; required only for `oauth_m2m` and stripped from every response returning `extraConfig` |
| `extraConfig.schema` | Required dbt target schema |
| `extraConfig.threads` | Optional int (1-32, default 4) |

The frontend save-time host guard must check the exact workspace hostname above.
It must not offer OAuth U2M/external-browser, Azure tenant auth, a custom OAuth
URL, proxy/HTTP settings, file paths, or TLS-disable options. The Prisma enum
needs `databricks`, and `ConnectionDialog.tsx`, the test-route mapping, and
`PENDING_IN_DIALOG` must then be updated together.

Test route config for `/connection/test` and `/connection/schema`:
`{host, http_path, auth_type, token?, client_id?, client_secret?, catalog?,
schema?}`. For PAT send `token`; for OAuth M2M send `client_id` and
`client_secret` and no token.
