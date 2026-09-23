"""Databricks adapter backed by databricks-sql-connector.

The SQL connector is blocking, so connection and query calls run in worker
threads. The workspace hostname and compute HTTP path are both validated and
pinned into the connector call and dbt profile; no URL, alternate host, proxy,
TLS override, or server-side file path is accepted from connection metadata.

Like every adapter, this imports nothing from ``app``. The caller runs the
validated workspace hostname through host_guard before this adapter connects.
"""

import asyncio
import re
from typing import Any, Dict, List, Optional

import yaml

from .base import BaseAdapter, Column, Table

DATABRICKS_PORT = 443

AUTH_PAT = "pat"
AUTH_OAUTH_M2M = "oauth_m2m"
AUTH_TYPES = (AUTH_PAT, AUTH_OAUTH_M2M)

_HOST_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_WORKSPACE_HOST_RE = re.compile(
    rf"^(?:{_HOST_LABEL}\.)+(?:cloud\.databricks\.com|"
    rf"azuredatabricks\.net|gcp\.databricks\.com)$"
)
_WAREHOUSE_PATH_RE = re.compile(r"^/sql/1\.0/warehouses/[a-z0-9]{16}$")
_CLUSTER_PATH_RE = re.compile(
    r"^/sql/protocolv1/o/[0-9]+/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$"
)


class DatabricksConfigError(ValueError):
    """Raised for Databricks configuration that cannot be connected with."""


def normalize_workspace_host(host: Any) -> str:
    """Validate and normalize a Databricks workspace hostname (never a URL)."""
    value = str(host or "").strip().lower()
    if not value:
        raise DatabricksConfigError(
            "A Databricks connection needs a workspace hostname, for example "
            "dbc-a1b2c3d4-e5f6.cloud.databricks.com"
        )
    if len(value) > 253 or not _WORKSPACE_HOST_RE.fullmatch(value):
        raise DatabricksConfigError(
            "Give only a Databricks workspace hostname ending in "
            ".cloud.databricks.com, .azuredatabricks.net, or "
            ".gcp.databricks.com (no scheme, port, path, or query)"
        )
    return value


def normalize_http_path(http_path: Any) -> str:
    """Validate a SQL warehouse or all-purpose cluster HTTP path."""
    value = str(http_path or "").strip()
    if not value or not (
        _WAREHOUSE_PATH_RE.fullmatch(value) or _CLUSTER_PATH_RE.fullmatch(value)
    ):
        raise DatabricksConfigError(
            "Give a Databricks HTTP path shaped like "
            "/sql/1.0/warehouses/<16-character-id> or "
            "/sql/protocolv1/o/<workspace-id>/<cluster-id>"
        )
    return value


def auth_type_of(config: Dict[str, Any]) -> str:
    raw = str(config.get("auth_type") or "").strip().lower()
    if not raw:
        return AUTH_OAUTH_M2M if config.get("client_id") else AUTH_PAT
    if raw not in AUTH_TYPES:
        raise DatabricksConfigError(
            f"Unsupported Databricks auth_type '{raw}'. Supported: "
            f"{', '.join(AUTH_TYPES)}"
        )
    return raw


class DatabricksAdapter(BaseAdapter):
    """Databricks SQL warehouse / all-purpose compute adapter.

    Config structure::

        {
            "host": "dbc-a1b2c3d4-e5f6.cloud.databricks.com",
            "http_path": "/sql/1.0/warehouses/1abc2d3456e7f890",
            "auth_type": "pat" | "oauth_m2m",
            "token": "dapi...",             # PAT
            "client_id": "service-principal", # OAuth M2M
            "client_secret": "dose...",       # OAuth M2M
            "catalog": "analytics",           # optional Unity Catalog
            "schema": "dbt_dev",
            "threads": 4,
        }

    No arbitrary connector/profile options are passed through. In particular,
    OAuth/SSO URLs, proxies, HTTP headers, file paths, and TLS overrides cannot
    redirect or weaken the validated connection.
    """

    adapter_type = "databricks"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._conn: Optional[Any] = None

    # -- connection -------------------------------------------------------

    def _connect_args(self) -> tuple[Dict[str, Any], Optional[Dict[str, str]]]:
        host = normalize_workspace_host(self.config.get("host"))
        http_path = normalize_http_path(self.config.get("http_path"))
        kwargs: Dict[str, Any] = {
            "server_hostname": host,
            "http_path": http_path,
        }
        for key in ("catalog", "schema"):
            value = str(self.config.get(key) or "").strip()
            if value:
                kwargs[key] = value

        if auth_type_of(self.config) == AUTH_OAUTH_M2M:
            client_id = str(self.config.get("client_id") or "").strip()
            client_secret = str(self.config.get("client_secret") or "")
            if not client_id or not client_secret:
                raise DatabricksConfigError(
                    "OAuth M2M authentication needs a client_id and client_secret"
                )
            return kwargs, {
                "host": host,
                "client_id": client_id,
                "client_secret": client_secret,
            }

        token = str(self.config.get("token") or "")
        if not token:
            raise DatabricksConfigError(
                "PAT authentication needs a personal access token"
            )
        kwargs["access_token"] = token
        return kwargs, None

    @staticmethod
    def _open(
        kwargs: Dict[str, Any], oauth_config: Optional[Dict[str, str]] = None
    ) -> Any:
        from databricks import sql

        connect_kwargs = dict(kwargs)
        if oauth_config:
            from databricks.sdk.core import Config, oauth_service_principal

            sdk_config = Config(
                host=f"https://{oauth_config['host']}",
                client_id=oauth_config["client_id"],
                client_secret=oauth_config["client_secret"],
                auth_type="oauth-m2m",
            )

            def credentials_provider() -> Any:
                return oauth_service_principal(sdk_config)

            connect_kwargs["credentials_provider"] = credentials_provider
        return sql.connect(**connect_kwargs)

    async def connect(self) -> None:
        kwargs, oauth_config = self._connect_args()
        self._conn = await asyncio.to_thread(self._open, kwargs, oauth_config)

    async def disconnect(self) -> None:
        if self._conn is not None:
            conn, self._conn = self._conn, None
            await asyncio.to_thread(conn.close)

    def _fetch(self, sql: str, params: tuple = ()) -> List[tuple]:
        if self._conn is None:
            raise RuntimeError("Connection not initialized. Call connect() first.")
        cursor = self._conn.cursor()
        try:
            if params:
                cursor.execute(sql, params)
            else:
                cursor.execute(sql)
            return list(cursor.fetchall())
        finally:
            cursor.close()

    async def _query(self, sql: str, params: tuple = ()) -> List[tuple]:
        return await asyncio.to_thread(self._fetch, sql, params)

    async def test_connection(self) -> Dict[str, Any]:
        """Log in and report the workspace session Databricks returned."""
        try:
            kwargs, _ = self._connect_args()
        except DatabricksConfigError as exc:
            return {"success": False, "message": str(exc)}

        try:
            await self.connect()
            try:
                rows = await self._query(
                    "SELECT current_catalog(), current_schema(), current_user(), version()"
                )
            finally:
                await self.disconnect()
        except Exception as exc:
            return {"success": False, "message": self._error_message(exc)}

        catalog, schema, user, version = rows[0] if rows else (None, None, None, None)
        return {
            "success": True,
            "message": "Connected successfully to Databricks",
            "details": {
                "host": kwargs["server_hostname"],
                "http_path": kwargs["http_path"],
                "catalog": catalog,
                "schema": schema,
                "user": user,
                "version": version or "Unknown",
            },
        }

    @staticmethod
    def _error_message(exc: Exception) -> str:
        # Connector/SDK exception text can include request details. Return a
        # bounded category instead of reflecting it (and possibly credentials)
        # to the browser.
        message = str(exc).lower()
        if any(word in message for word in ("401", "unauthorized", "authenticate")):
            return "Databricks authentication failed"
        if any(word in message for word in ("403", "forbidden", "permission")):
            return "Databricks rejected the credentials or permissions"
        if any(word in message for word in ("timeout", "timed out", "connection")):
            return "Cannot reach the Databricks workspace"
        if "http path" in message or "endpoint" in message or "warehouse" in message:
            return "The Databricks HTTP path was not found or is unavailable"
        return "Databricks connection failed"

    # -- introspection ----------------------------------------------------

    async def _get_schemas(self) -> List[str]:
        rows = await self._query(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE catalog_name = current_catalog() "
            "AND lower(schema_name) <> 'information_schema' ORDER BY schema_name"
        )
        return [row[0] for row in rows]

    async def _get_tables(self, schema: str) -> List[str]:
        rows = await self._query(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_catalog = current_catalog() AND table_schema = ? "
            "AND table_type NOT IN ('VIEW', 'MATERIALIZED_VIEW') ORDER BY table_name",
            (schema,),
        )
        return [row[0] for row in rows]

    async def _get_views(self, schema: str) -> List[str]:
        rows = await self._query(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_catalog = current_catalog() AND table_schema = ? "
            "AND table_type IN ('VIEW', 'MATERIALIZED_VIEW') ORDER BY table_name",
            (schema,),
        )
        return [row[0] for row in rows]

    _COLUMNS_SQL = (
        "SELECT table_schema, table_name, column_name, data_type, full_data_type, "
        "ordinal_position, is_nullable, character_maximum_length, "
        "numeric_precision, numeric_scale FROM information_schema.columns"
    )

    @staticmethod
    def _column(row: tuple) -> Column:
        return Column(
            name=row[2],
            type_name=row[4] or row[3],
            ordinal_position=row[5] or 0,
            nullable=row[6] == "YES",
            column_display_size=row[7] or row[8] or 0,
            precision=row[8] or 0,
            scale=row[9] or 0,
        )

    async def _get_columns(self, schema: str, table: str) -> List[Column]:
        rows = await self._query(
            self._COLUMNS_SQL
            + " WHERE table_catalog = current_catalog() AND table_schema = ? "
            "AND table_name = ? ORDER BY ordinal_position",
            (schema, table),
        )
        return [self._column(row) for row in rows]

    async def extract_schema(self) -> Dict[str, List[Table]]:
        """Browse the active catalog in two information_schema round trips."""
        try:
            await self.connect()
            try:
                relations = await self._query(
                    "SELECT table_schema, table_name, table_type "
                    "FROM information_schema.tables "
                    "WHERE table_catalog = current_catalog() "
                    "AND lower(table_schema) <> 'information_schema' "
                    "ORDER BY table_schema, table_name"
                )
                column_rows = await self._query(
                    self._COLUMNS_SQL + " WHERE table_catalog = current_catalog() "
                    "AND lower(table_schema) <> 'information_schema' "
                    "ORDER BY table_schema, table_name, ordinal_position"
                )
            finally:
                await self.disconnect()
        except DatabricksConfigError:
            raise
        except Exception as exc:
            # /connection/schema includes exception text in its response. Keep
            # connector/SDK request details (which can contain credentials) out.
            raise DatabricksConfigError(self._error_message(exc)) from None

        columns: Dict[tuple, List[Column]] = {}
        for row in column_rows:
            columns.setdefault((row[0], row[1]), []).append(self._column(row))

        tables = [
            Table(
                name=name,
                type="VIEW" if "VIEW" in str(kind).upper() else "TABLE",
                schema=schema,
                columns=columns.get((schema, name), []),
            )
            for schema, name, kind in relations
        ]
        return {"tables": [table.to_dict() for table in tables]}  # type: ignore[misc]

    # -- dbt profile ------------------------------------------------------

    def generate_profiles_yml(self, project_name: str, target: str = "dev") -> str:
        host = normalize_workspace_host(self.config.get("host"))
        http_path = normalize_http_path(self.config.get("http_path"))
        if not str(self.config.get("schema") or "").strip():
            raise DatabricksConfigError("A Databricks target needs a schema")

        output: Dict[str, Any] = {
            "type": "databricks",
            "host": host,
            "http_path": http_path,
            "schema": self.config["schema"],
            "threads": int(self.config.get("threads") or 4),
        }
        if self.config.get("catalog"):
            output["catalog"] = self.config["catalog"]

        if auth_type_of(self.config) == AUTH_OAUTH_M2M:
            if not self.config.get("client_id") or not self.config.get("client_secret"):
                raise DatabricksConfigError(
                    "OAuth M2M authentication needs a client_id and client_secret"
                )
            # dbt-databricks 1.10 calls the profile mode `oauth`; client_id plus
            # client_secret selects its OAuth M2M credential provider.
            output["auth_type"] = "oauth"
            output["client_id"] = self.config["client_id"]
            output["client_secret"] = self.config["client_secret"]
        else:
            if not self.config.get("token"):
                raise DatabricksConfigError(
                    "PAT authentication needs a personal access token"
                )
            output["token"] = self.config["token"]

        return yaml.safe_dump(
            {project_name: {"outputs": {target: output}, "target": target}},
            sort_keys=False,
            default_flow_style=False,
        )
