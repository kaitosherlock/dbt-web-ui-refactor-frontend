"""The host a connection config reaches, run through host_guard.

One function for every path that opens a warehouse connection itself -
/connection/test, /connection/schema, the ingest table picker and the per-target
check - so a type whose host is not simply `config["host"]` (Snowflake derives
it from the account) is guarded the same way on all of them.
"""

from typing import Any, Dict

from adapters import databricks as databricks_adapter
from adapters import snowflake as snowflake_adapter
from app.core.host_guard import HostNotAllowed, assert_host_allowed

# DuckDB is a local file and Spark is reached through its own session config, so
# neither carries a network host to check.
HOSTLESS_TYPES = frozenset({"duckdb", "spark"})


def target_endpoint(conn_type: str, config: Dict[str, Any]) -> tuple[str, int | None]:
    """(host, port) a connection of this type will dial, from its adapter config.

    Raises HostNotAllowed when an adapter-specific host identifier is invalid:
    an unvalidated value is an unvalidated host name.
    """
    config = config or {}
    if conn_type == "snowflake":
        try:
            host = snowflake_adapter.account_host(config.get("account"))
        except snowflake_adapter.SnowflakeConfigError as exc:
            raise HostNotAllowed(str(exc)) from exc
        return host, snowflake_adapter.SNOWFLAKE_PORT

    if conn_type == "databricks":
        try:
            host = databricks_adapter.normalize_workspace_host(config.get("host"))
        except databricks_adapter.DatabricksConfigError as exc:
            raise HostNotAllowed(str(exc)) from exc
        return host, databricks_adapter.DATABRICKS_PORT

    host = str(config.get("host") or "").strip()
    raw_port = config.get("port")
    try:
        port = int(raw_port) if raw_port else None
    except (TypeError, ValueError):
        port = None
    return host, port


def assert_connection_target_allowed(conn_type: str, config: Dict[str, Any]) -> None:
    """Refuse connections aimed at this deployment's own infrastructure.

    Without this, a user can point a connection at the application's Postgres,
    attach it to a project, and read every other user's encrypted warehouse
    credentials out of the `connections` table through ordinary dbt queries.
    """
    if conn_type in HOSTLESS_TYPES:
        return
    host, port = target_endpoint(conn_type, config)
    if not host:
        return
    assert_host_allowed(host, port)
