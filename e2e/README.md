# Full dbt flow driver

`dbt_flow.py` exercises the dbt-core 1.x parity surface end to end through the
same HTTP routes used by the application. It creates a uniquely named project,
loads the four CSV seeds, builds and tests the fixture project, then covers
preview, compile, docs, macros, selectors, retry, state/defer, clone, and run
history.

The driver requires Python 3.13 and only the standard library plus `httpx`.
The compose stack must be running with `AUTH_DISABLED=true`. For the Postgres
flow, it must also have `INGEST_ALLOW_PRIVATE_HOSTS=true`, because the demo
warehouse is on the private Compose network. Start the demo source service as
well:

```powershell
$env:AUTH_DISABLED = "true"
$env:INGEST_ALLOW_PRIVATE_HOSTS = "true"
docker compose up -d
docker compose --profile demo up -d demo-source
uv run --with httpx python e2e/dbt_flow.py --adapter postgres
```

Add `--cleanup` to drop the test schemas and remove the generated project,
project storage/state, target, and connections after the assertions finish:

```powershell
uv run --with httpx python e2e/dbt_flow.py --adapter postgres --cleanup
```

Without `--cleanup`, the resources are intentionally retained for inspection.
Project and connection names are unique per invocation. The warehouse schemas
are fixed at `dbt_e2e` / `dbt_e2e_prod` for Postgres and
`dbt_craft_e2e` / `dbt_craft_e2e_prod` for Databricks, so do not run two flows
against the same warehouse concurrently.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `E2E_FRONTEND_URL` | No | `http://localhost:3000` | Next.js base URL. |
| `E2E_CSV_DIR` | No | `C:/Users/admin/Downloads` | Directory containing the four CSV files listed below. |
| `E2E_PG_PASSWORD` | Postgres: no | `demo_owner_pw` | Password for `demo@dbt-craft-demo-source:5432/crm`. |
| `E2E_DBX_HOST` | Databricks: yes | — | Workspace hostname only, without scheme or path. |
| `E2E_DBX_HTTP_PATH` | Databricks: yes | — | SQL warehouse or cluster HTTP path. |
| `E2E_DBX_TOKEN` | Databricks: yes | — | PAT. It is redacted from driver output. |
| `E2E_DBX_CATALOG` | Databricks: no | `workspace` | Unity Catalog catalog. |
| `E2E_HTTP_TIMEOUT` | No | `180` | Timeout in seconds for one HTTP request. |
| `E2E_RUN_TIMEOUT` | No | `1200` | Maximum seconds to wait for one asynchronous dbt run. |
| `E2E_POLL_INTERVAL` | No | `2` | Run-status polling interval in seconds. |

The CSV directory must contain:

- `jaffle_shop_customers.csv`
- `jaffle_shop_orders.csv`
- `stripe_payments.csv`
- `transactions_batch1.csv`

The driver validates their headers before uploading them. The Databricks
command is:

```powershell
$env:E2E_DBX_HOST = "dbc-example.cloud.databricks.com"
$env:E2E_DBX_HTTP_PATH = "/sql/1.0/warehouses/0123456789abcdef"
$env:E2E_DBX_TOKEN = "..."
uv run --with httpx python e2e/dbt_flow.py --adapter databricks --cleanup
```

The local-auth login is established automatically through the Auth.js
credentials callback. Connection/project/target/history CRUD uses Next.js API
routes. Project files and dbt operations use the dbt-runner proxy under
`/api/dbt-runner`, matching the UI's actual file editor behavior. `/api/files`
is not used because that route stores personal uploads rather than files in a
dbt project.
