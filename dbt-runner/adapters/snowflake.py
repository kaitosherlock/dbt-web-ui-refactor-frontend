"""
Snowflake adapter - uses snowflake-connector-python.

The connector is blocking, so every call runs in a worker thread. Snowflake is
reached at `<account>.snowflakecomputing.com`, which means the account
identifier *is* the host: it is validated here, strictly, and the host derived
from it is pinned into both the connector call and the dbt profile, so the host
the connection router checks with host_guard is exactly the one dialled. A
`host` sent by a client is never used.

Like every adapter, this imports nothing from `app`: host_guard is the caller's
job (`app/services/connection_targets.py`), and the secret arrives already
resolved - a real value for a direct connection, an env_var() placeholder for
profiles.yml.
"""
import asyncio
import re
from typing import Any, Dict, List, Optional

import yaml

from .base import BaseAdapter, Column, Table

SNOWFLAKE_DOMAIN = "snowflakecomputing.com"
SNOWFLAKE_PORT = 443

AUTH_PASSWORD = "password"
AUTH_KEYPAIR = "keypair"
AUTH_TYPES = (AUTH_PASSWORD, AUTH_KEYPAIR)

# An account identifier is either `orgname-accountname` or a legacy locator,
# optionally followed by region / cloud / `privatelink` segments:
#   myorg-myaccount   xy12345   xy12345.eu-west-1   xy12345.us-east-2.aws
#   myorg-myaccount.privatelink
# Nothing else - no scheme, port, path, `@` or whitespace - may reach the host
# name, because anything that could end the label could also change the domain.
_ACCOUNT_RE = re.compile(
    r"^[a-z0-9](?:[a-z0-9_-]{0,253}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,3}$"
)


class SnowflakeConfigError(ValueError):
    """Raised for a Snowflake configuration that cannot be connected with."""


def normalize_account(account: Any) -> str:
    """Validate an account identifier and return it in the form used in a host.

    Underscores become hyphens, as dbt-snowflake does itself: Snowflake account
    names may contain `_`, host names may not.
    """
    value = str(account or "").strip().lower()
    if not value:
        raise SnowflakeConfigError(
            "A Snowflake connection needs an account identifier, for example "
            "myorg-myaccount"
        )
    if SNOWFLAKE_DOMAIN in value or any(ch in value for ch in "/:@"):
        raise SnowflakeConfigError(
            "Give the Snowflake account identifier (for example myorg-myaccount "
            f"or xy12345.eu-west-1), not the {SNOWFLAKE_DOMAIN} URL"
        )
    if len(value) > 255 or not _ACCOUNT_RE.match(value):
        raise SnowflakeConfigError(
            f"'{value}' is not a Snowflake account identifier. Use "
            "orgname-accountname or an account locator such as xy12345.eu-west-1"
        )
    return value.replace("_", "-")


def account_host(account: Any) -> str:
    """The host a Snowflake account is reached at - the value host_guard checks."""
    return f"{normalize_account(account)}.{SNOWFLAKE_DOMAIN}"


def auth_type_of(config: Dict[str, Any]) -> str:
    raw = str(config.get("auth_type") or "").strip().lower()
    if not raw:
        return AUTH_KEYPAIR if config.get("private_key") else AUTH_PASSWORD
    if raw not in AUTH_TYPES:
        raise SnowflakeConfigError(
            f"Unsupported Snowflake auth_type '{raw}'. Supported: {', '.join(AUTH_TYPES)}"
        )
    return raw


def load_private_key(pem: str, passphrase: Optional[str] = None) -> bytes:
    """PEM private key (optionally encrypted) as the DER bytes the connector takes.

    The message never quotes the key: it reaches the browser.
    """
    from cryptography.hazmat.primitives import serialization

    try:
        key = serialization.load_pem_private_key(
            str(pem or "").strip().encode("utf-8"),
            password=passphrase.encode("utf-8") if passphrase else None,
        )
    except (ValueError, TypeError) as exc:
        raise SnowflakeConfigError(
            "The private key could not be read: it must be a PEM private key, "
            "and the passphrase must match if the key is encrypted"
        ) from exc
    return key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


class SnowflakeAdapter(BaseAdapter):
    """
    Snowflake warehouse adapter.

    Config structure:
    {
        "account": "myorg-myaccount",
        "user": "DBT_USER",
        "auth_type": "password" | "keypair",   # defaults from what is present
        "password": "secret",                   # auth_type password
        "private_key": "-----BEGIN PRIVATE KEY-----...",  # auth_type keypair
        "private_key_passphrase": "optional",   # keypair, encrypted key only
        "role": "TRANSFORMER",                  # optional
        "warehouse": "TRANSFORMING",            # optional (user default)
        "database": "ANALYTICS",                # needed to browse / run dbt
        "schema": "DBT_DEV",                    # needed for profiles.yml
        "threads": 4                            # optional, for profiles.yml
        # optional, profiles.yml only - see PROFILE_OPTION_TYPES
    }
    """

    adapter_type = "snowflake"

    # dbt-snowflake options a connection may set, with the type each must have.
    # Deliberately not here: host/port/protocol/proxy_* (the host is derived
    # from the account), authenticator and token (externalbrowser/okta/oauth
    # reach other hosts), private_key_path (reads a file on this server) and
    # insecure_mode (turns off certificate checks).
    PROFILE_OPTION_TYPES = {
        "query_tag": str,
        "client_session_keep_alive": bool,
        "connect_retries": int,
        "connect_timeout": int,
        "retry_on_database_errors": bool,
        "retry_all": bool,
        "reuse_connections": bool,
    }

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._conn: Optional[Any] = None

    # -- connection -------------------------------------------------------

    def _connect_kwargs(self) -> Dict[str, Any]:
        account = normalize_account(self.config.get("account"))
        kwargs: Dict[str, Any] = {
            "account": account,
            # Pinned rather than left to the connector, so the dialled host is
            # the one host_guard approved.
            "host": f"{account}.{SNOWFLAKE_DOMAIN}",
            "port": SNOWFLAKE_PORT,
            "protocol": "https",
            "user": self.config.get("user"),
            "login_timeout": 20,
            "network_timeout": 60,
            # No client telemetry from this deployment (CLAUDE.md, Don't).
            "session_parameters": {"CLIENT_TELEMETRY_ENABLED": False},
        }
        for key in ("role", "warehouse", "database", "schema"):
            value = str(self.config.get(key) or "").strip()
            if value:
                kwargs[key] = value

        if auth_type_of(self.config) == AUTH_KEYPAIR:
            if not self.config.get("private_key"):
                raise SnowflakeConfigError("Key-pair authentication needs a private key")
            kwargs["private_key"] = load_private_key(
                self.config["private_key"], self.config.get("private_key_passphrase")
            )
        else:
            kwargs["password"] = self.config.get("password") or ""
        return kwargs

    @staticmethod
    def _open(kwargs: Dict[str, Any]) -> Any:
        import snowflake.connector

        return snowflake.connector.connect(**kwargs)

    async def connect(self) -> None:
        kwargs = self._connect_kwargs()
        self._conn = await asyncio.to_thread(self._open, kwargs)

    async def disconnect(self) -> None:
        if self._conn is not None:
            conn, self._conn = self._conn, None
            await asyncio.to_thread(conn.close)

    def _fetch(self, sql: str, params: tuple = ()) -> List[tuple]:
        if self._conn is None:
            raise RuntimeError("Connection not initialized. Call connect() first.")
        cursor = self._conn.cursor()
        try:
            cursor.execute(sql, params)
            return list(cursor.fetchall())
        finally:
            cursor.close()

    async def _query(self, sql: str, params: tuple = ()) -> List[tuple]:
        return await asyncio.to_thread(self._fetch, sql, params)

    async def test_connection(self) -> Dict[str, Any]:
        """Log in and report the session Snowflake gave us."""
        try:
            kwargs = self._connect_kwargs()
        except SnowflakeConfigError as exc:
            return {"success": False, "message": str(exc)}

        try:
            await self.connect()
            try:
                rows = await self._query(
                    "SELECT CURRENT_VERSION(), CURRENT_ACCOUNT(), CURRENT_ROLE(), "
                    "CURRENT_WAREHOUSE(), CURRENT_DATABASE()"
                )
            finally:
                await self.disconnect()
        except Exception as exc:
            return {"success": False, "message": self._error_message(exc)}

        version, account, role, warehouse, database = (
            rows[0] if rows else (None, None, None, None, None)
        )
        return {
            "success": True,
            "message": "Connected successfully to Snowflake",
            "details": {
                "version": version or "Unknown",
                "host": kwargs["host"],
                "account": account,
                "role": role,
                "warehouse": warehouse,
                "database": database,
            },
        }

    @staticmethod
    def _error_message(exc: Exception) -> str:
        try:
            from snowflake.connector import errors
        except ImportError:  # pragma: no cover - the package is a dependency
            return str(exc)
        if isinstance(exc, errors.DatabaseError):
            errno = getattr(exc, "errno", None)
            if errno == 390100:
                return "Incorrect username or password"
            if errno in (390144, 390146):
                return "The private key was rejected for this user (JWT token invalid)"
            if errno == 250001:
                return f"Cannot reach Snowflake: {getattr(exc, 'msg', None) or exc}"
            return getattr(exc, "msg", None) or str(exc)
        return str(exc)

    # -- introspection ----------------------------------------------------
    # Always within the connected database (INFORMATION_SCHEMA of the current
    # database), so no identifier is ever concatenated into SQL; values are
    # bound. A database is required to browse, the way `service` is for Oracle.

    def _require_database(self) -> None:
        if not str(self.config.get("database") or "").strip():
            raise SnowflakeConfigError("Set a database on the connection to browse its tables")

    async def _get_schemas(self) -> List[str]:
        rows = await self._query(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name <> 'INFORMATION_SCHEMA' ORDER BY schema_name"
        )
        return [row[0] for row in rows]

    async def _get_tables(self, schema: str) -> List[str]:
        rows = await self._query(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = %s AND table_type = 'BASE TABLE' ORDER BY table_name",
            (schema,),
        )
        return [row[0] for row in rows]

    async def _get_views(self, schema: str) -> List[str]:
        rows = await self._query(
            "SELECT table_name FROM information_schema.views "
            "WHERE table_schema = %s ORDER BY table_name",
            (schema,),
        )
        return [row[0] for row in rows]

    _COLUMNS_SQL = (
        "SELECT table_schema, table_name, column_name, data_type, ordinal_position, "
        "is_nullable, character_maximum_length, numeric_precision, numeric_scale, "
        "is_identity FROM information_schema.columns"
    )

    @staticmethod
    def _column(row: tuple) -> Column:
        # Snowflake's INFORMATION_SCHEMA has no key_column_usage, and primary
        # keys there are informational only, so primary_key stays False.
        return Column(
            name=row[2],
            type_name=row[3],
            ordinal_position=row[4] or 0,
            nullable=row[5] == "YES",
            autoincrement=row[9] == "YES",
            column_display_size=row[6] or row[7] or 0,
            scale=row[8] or 0,
            precision=row[7] or 0,
        )

    async def _get_columns(self, schema: str, table: str) -> List[Column]:
        rows = await self._query(
            self._COLUMNS_SQL
            + " WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
            (schema, table),
        )
        return [self._column(row) for row in rows]

    async def extract_schema(self) -> Dict[str, List[Table]]:
        """Tables and views of the connected database, in two round trips.

        Not one query per table the way the Postgres adapter does it: every
        Snowflake statement is a network round trip plus compilation, and a
        database of a few hundred tables would take minutes.
        """
        self._require_database()
        await self.connect()
        try:
            relations = await self._query(
                "SELECT table_schema, table_name, table_type FROM information_schema.tables "
                "WHERE table_schema <> 'INFORMATION_SCHEMA' "
                "ORDER BY table_schema, table_name"
            )
            column_rows = await self._query(
                self._COLUMNS_SQL
                + " WHERE table_schema <> 'INFORMATION_SCHEMA' "
                "ORDER BY table_schema, table_name, ordinal_position"
            )
        finally:
            await self.disconnect()

        columns: Dict[tuple, List[Column]] = {}
        for row in column_rows:
            columns.setdefault((row[0], row[1]), []).append(self._column(row))

        tables = [
            Table(
                name=name,
                type="VIEW" if kind == "VIEW" else "TABLE",
                schema=schema,
                columns=columns.get((schema, name), []),
            )
            for schema, name, kind in relations
        ]
        return {"tables": [t.to_dict() for t in tables]}  # type: ignore[misc]

    # -- dbt profile ------------------------------------------------------

    def generate_profiles_yml(self, project_name: str, target: str = "dev") -> str:
        """dbt-snowflake profile. Secrets are whatever the caller put in config -
        in profiles.yml that is always an env_var() placeholder."""
        account = normalize_account(self.config.get("account"))
        for key in ("user", "database", "schema"):
            if not str(self.config.get(key) or "").strip():
                raise SnowflakeConfigError(f"A Snowflake target needs a {key}")

        output: Dict[str, Any] = {
            "type": "snowflake",
            "account": account,
            "host": f"{account}.{SNOWFLAKE_DOMAIN}",
            "user": self.config["user"],
        }
        if auth_type_of(self.config) == AUTH_KEYPAIR:
            output["private_key"] = self.config.get("private_key")
            if self.config.get("private_key_passphrase"):
                output["private_key_passphrase"] = self.config["private_key_passphrase"]
        else:
            output["password"] = self.config.get("password")
        for key in ("role", "warehouse"):
            if self.config.get(key):
                output[key] = self.config[key]
        output["database"] = self.config["database"]
        output["schema"] = self.config["schema"]
        output["threads"] = int(self.config.get("threads") or 4)
        for key, kind in self.PROFILE_OPTION_TYPES.items():
            value = self.config.get(key)
            # bool is an int subclass; an int option must not accept True.
            if isinstance(value, kind) and not (kind is int and isinstance(value, bool)):
                output[key] = value

        # safe_dump, not an f-string: a value with a quote, a colon or a newline
        # must stay a value.
        return yaml.safe_dump(
            {project_name: {"outputs": {target: output}, "target": target}},
            sort_keys=False,
            default_flow_style=False,
        )
