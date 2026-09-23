"""Snowflake as a warehouse: account validation, host guard, profile, adapter.

No real Snowflake: the connector is mocked. What matters here is what cannot be
seen by running it once against a live account - that the account identifier is
the host name and is validated as one, that neither the password nor the
private key nor its passphrase ever lands in profiles.yml, and that the host
host_guard approves is the host actually dialled.
"""

import asyncio
import ipaddress
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters import ADAPTERS, get_adapter, list_adapters
from adapters.snowflake import (
    SNOWFLAKE_DOMAIN,
    SnowflakeAdapter,
    SnowflakeConfigError,
    account_host,
    normalize_account,
)
from app.core.host_guard import HostNotAllowed
from app.exceptions import DbtOperationError
from app.routers.dbt import _redact_profiles_yml
from app.services.connection_targets import assert_connection_target_allowed
from app.services.dbt_environment import (
    DBT_PROFILE_SECONDARY_SECRET_ENV,
    DBT_PROFILE_SECRET_ENV,
)
from app.services.dbt_service import (
    DBT_PROFILE_SECONDARY_SECRET_PLACEHOLDER,
    DBT_PROFILE_SECRET_PLACEHOLDER,
    SECONDARY_SECRET_KEY,
    DbtService,
    build_adapter_config_from_connection_row,
    build_adapter_config_with_secrets,
)
from ingest.destination import UnsupportedDestination, build_destination
from ingest.sql_source import supported_source_types

PASSWORD = "sf-password-value"
PASSPHRASE = "sf-passphrase-value"


def _pem(passphrase=None) -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    encryption = (
        serialization.BestAvailableEncryption(passphrase.encode())
        if passphrase
        else serialization.NoEncryption()
    )
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption
    ).decode()


PEM = _pem(PASSPHRASE)


def _row(auth_type="password", secret=PASSWORD, passphrase=None, **extra):
    extra_config = {
        "account": "myorg-myaccount",
        "auth_type": auth_type,
        "role": "TRANSFORMER",
        "warehouse": "TRANSFORMING",
        "schema": "DBT_DEV",
        **extra,
    }
    if passphrase:
        extra_config[SECONDARY_SECRET_KEY] = passphrase
    return {
        "connection_type": "snowflake",
        "host": f"myorg-myaccount.{SNOWFLAKE_DOMAIN}",
        "port": 443,
        "database": "ANALYTICS",
        "username": "DBT_USER",
        "password_encrypted": secret,
        "extra_config": extra_config,
    }


def _profile_output(row) -> dict:
    conn_type, config, needs_secret = build_adapter_config_from_connection_row(row)
    assert conn_type == "snowflake" and needs_secret
    rendered = yaml.safe_load(get_adapter(conn_type, config).generate_profiles_yml("proj"))
    return rendered["proj"]["outputs"]["dev"]


# -- account identifier -------------------------------------------------------


@pytest.mark.parametrize(
    "account, expected",
    [
        ("myorg-myaccount", "myorg-myaccount"),
        ("MyOrg-MyAccount", "myorg-myaccount"),
        ("myorg-my_account", "myorg-my-account"),
        ("xy12345", "xy12345"),
        ("xy12345.eu-west-1", "xy12345.eu-west-1"),
        ("xy12345.us-east-2.aws", "xy12345.us-east-2.aws"),
        ("myorg-myaccount.privatelink", "myorg-myaccount.privatelink"),
        ("  xy12345  ", "xy12345"),
    ],
)
def test_valid_account_identifiers(account, expected):
    assert normalize_account(account) == expected
    assert account_host(account) == f"{expected}.{SNOWFLAKE_DOMAIN}"


@pytest.mark.parametrize(
    "account",
    [
        "",
        None,
        "https://xy12345.snowflakecomputing.com",
        "xy12345.snowflakecomputing.com",
        "evil.com/",
        "evil.com:443",
        "user@evil.com",
        "evil.com#",
        "evil.com?x=",
        "xy 12345",
        "xy12345\n.evil.com",
        "a..b",
        ".xy12345",
        "xy12345.",
        "-xy12345",
        "xy12345-",
        "a.b.c.d.e",  # more than three suffix segments
        "x" * 300,
    ],
)
def test_invalid_account_identifiers_are_refused(account):
    with pytest.raises(SnowflakeConfigError):
        normalize_account(account)


# -- registry and host guard --------------------------------------------------


def test_registry_lists_snowflake():
    assert ADAPTERS["snowflake"] is SnowflakeAdapter
    assert list_adapters()["snowflake"] == "SnowflakeAdapter"
    assert isinstance(get_adapter("snowflake", {"account": "xy12345"}), SnowflakeAdapter)


def test_host_guard_checks_the_host_derived_from_the_account():
    with patch("app.services.connection_targets.assert_host_allowed") as guard:
        assert_connection_target_allowed(
            "snowflake",
            # A client-sent host is not what gets dialled, so not what is checked.
            {"account": "xy12345.eu-west-1", "host": "127.0.0.1", "port": 5432},
        )
    guard.assert_called_once_with(f"xy12345.eu-west-1.{SNOWFLAKE_DOMAIN}", 443)


def test_host_guard_refuses_an_invalid_account():
    with patch("app.services.connection_targets.assert_host_allowed") as guard:
        with pytest.raises(HostNotAllowed):
            assert_connection_target_allowed("snowflake", {"account": "evil.com/x"})
    guard.assert_not_called()


def test_host_guard_refuses_an_account_that_resolves_to_loopback():
    # privatelink names resolve to whatever DNS says; the resolved address is
    # what host_guard judges, like for every other type.
    with patch(
        "app.core.host_guard._resolve",
        return_value=[ipaddress.ip_address("127.0.0.1")],
    ):
        with pytest.raises(HostNotAllowed):
            assert_connection_target_allowed(
                "snowflake", {"account": "myorg-myaccount.privatelink"}
            )


def test_connection_test_route_refuses_before_connecting():
    from app.models.connection import ConnectionTestRequest
    from app.routers.connection import test_connection as route

    request = ConnectionTestRequest(
        type="snowflake", name="sf", config={"account": "https://evil.example/"}
    )
    with patch("snowflake.connector.connect") as connect:
        result = asyncio.run(route(request, claims={}))
    assert result["success"] is False
    assert "account identifier" in result["message"]
    connect.assert_not_called()


# -- profile rendering --------------------------------------------------------


def test_password_profile_uses_the_secret_env_var():
    output = _profile_output(_row())
    assert output["type"] == "snowflake"
    assert output["account"] == "myorg-myaccount"
    assert output["host"] == f"myorg-myaccount.{SNOWFLAKE_DOMAIN}"
    assert output["user"] == "DBT_USER"
    assert output["role"] == "TRANSFORMER"
    assert output["warehouse"] == "TRANSFORMING"
    assert output["database"] == "ANALYTICS"
    assert output["schema"] == "DBT_DEV"
    assert output["threads"] == 4
    assert output["password"] == DBT_PROFILE_SECRET_PLACEHOLDER
    assert "private_key" not in output


def test_keypair_profile_uses_env_vars_for_key_and_passphrase():
    output = _profile_output(_row("keypair", secret=PEM, passphrase="ciphertext"))
    assert output["private_key"] == DBT_PROFILE_SECRET_PLACEHOLDER
    assert output["private_key_passphrase"] == DBT_PROFILE_SECONDARY_SECRET_PLACEHOLDER
    assert "password" not in output
    assert SECONDARY_SECRET_KEY not in output


def test_keypair_without_passphrase_has_no_passphrase_field():
    output = _profile_output(_row("keypair", secret=_pem()))
    assert output["private_key"] == DBT_PROFILE_SECRET_PLACEHOLDER
    assert "private_key_passphrase" not in output


def test_only_whitelisted_options_reach_the_profile():
    output = _profile_output(
        _row(
            query_tag="dbt-craft",
            connect_retries=3,
            client_session_keep_alive="yes",  # wrong type: dropped
            authenticator="externalbrowser",
            private_key_path="/etc/shadow",
            insecure_mode=True,
            proxy_host="10.0.0.1",
            host="127.0.0.1",
            threads="8",
        )
    )
    assert output["query_tag"] == "dbt-craft"
    assert output["connect_retries"] == 3
    assert output["threads"] == 8
    for key in (
        "client_session_keep_alive",
        "authenticator",
        "private_key_path",
        "insecure_mode",
        "proxy_host",
    ):
        assert key not in output
    assert output["host"] == f"myorg-myaccount.{SNOWFLAKE_DOMAIN}"


@pytest.mark.parametrize(
    "change",
    [
        {"extra_config": {"account": "evil.com/", "schema": "S"}},
        {"extra_config": {"account": "xy12345"}},  # no schema
        {"database": ""},
    ],
)
def test_profile_refuses_an_unusable_target(change):
    row = {**_row(), **change}
    _, config, _ = build_adapter_config_from_connection_row(row)
    with pytest.raises(SnowflakeConfigError):
        get_adapter("snowflake", config).generate_profiles_yml("proj")


def test_values_cannot_break_out_of_the_yaml():
    row = _row(role="R\nevil: true", query_tag="x: y\n  password: leaked")
    output = _profile_output(row)
    assert output["role"] == "R\nevil: true"
    assert "evil" not in output


def test_direct_config_carries_the_real_secrets_in_the_right_fields():
    row = _row("keypair", secret=PEM, passphrase=PASSPHRASE)
    with patch(
        "app.services.dbt_service.decrypt_secret_or_plaintext",
        side_effect=lambda value: value or "",
    ):
        conn_type, config = build_adapter_config_with_secrets(row)
    assert conn_type == "snowflake"
    assert config["private_key"] == PEM
    assert config["private_key_passphrase"] == PASSPHRASE
    assert "password" not in config


def test_diagnostic_preview_redacts_key_pair_fields():
    content = yaml.safe_dump(
        {"p": {"outputs": {"dev": {"private_key": PEM, "private_key_passphrase": "x"}}}}
    )
    redacted = _redact_profiles_yml(content)
    assert "PRIVATE KEY" not in redacted
    assert "private_key_passphrase: '***REDACTED***'" in redacted


# -- full regeneration: secrets, targets, DuckDB-only features ----------------

DEV_ID = "11111111-1111-1111-1111-111111111111"
PROD_ID = "22222222-2222-2222-2222-222222222222"


class _Result:
    def __init__(self, *, row=None, rows=None, scalar=None):
        self._row, self._rows, self._scalar = row, rows or [], scalar

    def mappings(self):
        return self

    def first(self):
        return self._row

    def all(self):
        return self._rows

    def scalar(self):
        return self._scalar


class _Session:
    def __init__(self, connections, targets):
        self._connections, self._targets = connections, targets

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "to_regclass('project_targets')" in sql:
            return _Result(scalar=True)
        if "FROM dbt_projects" in sql:
            return _Result(row={"connection_id": DEV_ID, "dremio_source_id": None})
        if "FROM project_targets" in sql:
            return _Result(rows=self._targets)
        if "FROM connections" in sql:
            return _Result(row=self._connections[(params or {})["cid"]])
        raise AssertionError(f"unexpected query: {sql}")


def _regenerate(tmp_path, connections, targets=(), lake=None):
    (tmp_path / "dbt_project.yml").write_text("name: 'proj'\nprofile: 'proj'\n")
    session = _Session(connections, list(targets))
    with patch(
        "app.services.dbt_service.decrypt_secret_or_plaintext",
        side_effect=lambda value: value or "",
    ), patch.object(
        DbtService, "_resolve_lakehouse", AsyncMock(return_value=lake)
    ), patch(
        "app.services.dbt_service.lakehouse.dbt_attach_entry",
        return_value={"path": "ducklake:x", "alias": "lake"},
    ), patch(
        "app.services.dbt_service.lakehouse.catalog_password", return_value=""
    ), patch(
        "app.services.dbt_service.duckdb_resources.profile_settings",
        return_value={"memory_limit": "1GB"},
    ), patch(
        "app.services.dbt_service.warm_worker_pool.release_project", AsyncMock()
    ):
        env = asyncio.run(DbtService._regenerate_profiles_from_db(session, "pid", tmp_path))
    written = (tmp_path / "profiles.yml").read_text()
    return yaml.safe_load(written)["proj"], env, written


def test_secrets_reach_dbt_through_env_and_never_the_file(tmp_path):
    connections = {
        DEV_ID: _row(),
        PROD_ID: _row("keypair", secret=PEM, passphrase=PASSPHRASE),
    }
    profile, env, written = _regenerate(
        tmp_path, connections, [{"name": "prod", "connection_id": PROD_ID}]
    )

    assert env[DBT_PROFILE_SECRET_ENV] == PASSWORD
    assert env[f"{DBT_PROFILE_SECRET_ENV}__PROD"] == PEM
    assert env[f"{DBT_PROFILE_SECONDARY_SECRET_ENV}__PROD"] == PASSPHRASE
    # dev has no passphrase, so no secondary env var either.
    assert DBT_PROFILE_SECONDARY_SECRET_ENV not in env

    prod = profile["outputs"]["prod"]
    assert f"{DBT_PROFILE_SECRET_ENV}__PROD" in prod["private_key"]
    assert f"{DBT_PROFILE_SECONDARY_SECRET_ENV}__PROD" in prod["private_key_passphrase"]
    assert DBT_PROFILE_SECRET_ENV in profile["outputs"]["dev"]["password"]

    for secret in (PASSWORD, PASSPHRASE, "PRIVATE KEY", PEM.splitlines()[1]):
        assert secret not in written


def test_duckdb_only_features_stay_off_for_snowflake_targets(tmp_path):
    duckdb_row = {
        "connection_type": "duckdb",
        "host": "",
        "port": 0,
        "database": str(tmp_path / "dev.duckdb"),
        "username": "",
        "password_encrypted": None,
        "extra_config": {},
    }
    profile, _, _ = _regenerate(
        tmp_path,
        {DEV_ID: duckdb_row, PROD_ID: _row()},
        [{"name": "prod", "connection_id": PROD_ID}],
        lake=SimpleNamespace(catalog_url="postgresql://lakehost/cat"),
    )
    dev, prod = profile["outputs"]["dev"], profile["outputs"]["prod"]
    assert dev["attach"] and dev["settings"] == {"memory_limit": "1GB"}
    for key in ("attach", "extensions", "settings"):
        assert key not in prod


def test_a_lake_on_a_snowflake_only_project_is_refused_by_name(tmp_path):
    with pytest.raises(DbtOperationError) as raised:
        _regenerate(
            tmp_path,
            {DEV_ID: _row()},
            lake=SimpleNamespace(catalog_url="postgresql://lakehost/cat"),
        )
    assert "snowflake" in raised.value.message


# -- adapter methods, connector mocked ----------------------------------------


def _mock_connection(*results):
    conn = MagicMock()
    cursor = conn.cursor.return_value
    cursor.fetchall.side_effect = list(results)
    return conn, cursor


def test_test_connection_pins_the_host_and_reports_the_session():
    conn, cursor = _mock_connection(
        [("8.30.0", "XY12345", "TRANSFORMER", "TRANSFORMING", "ANALYTICS")]
    )
    adapter = SnowflakeAdapter(
        {
            "account": "myorg-myaccount",
            "host": "127.0.0.1",
            "user": "DBT_USER",
            "password": PASSWORD,
            "warehouse": "TRANSFORMING",
            "database": "ANALYTICS",
        }
    )
    with patch("snowflake.connector.connect", return_value=conn) as connect:
        result = asyncio.run(adapter.test_connection())

    assert result["success"] is True
    assert result["details"]["version"] == "8.30.0"
    kwargs = connect.call_args.kwargs
    assert kwargs["host"] == f"myorg-myaccount.{SNOWFLAKE_DOMAIN}"
    assert kwargs["port"] == 443
    assert kwargs["password"] == PASSWORD
    assert kwargs["warehouse"] == "TRANSFORMING"
    assert "private_key" not in kwargs and "authenticator" not in kwargs
    conn.close.assert_called_once()


def test_keypair_connect_passes_a_decrypted_der_key():
    conn, _ = _mock_connection([("8", None, None, None, None)])
    adapter = SnowflakeAdapter(
        {
            "account": "xy12345",
            "user": "U",
            "auth_type": "keypair",
            "private_key": PEM,
            "private_key_passphrase": PASSPHRASE,
        }
    )
    with patch("snowflake.connector.connect", return_value=conn) as connect:
        assert asyncio.run(adapter.test_connection())["success"] is True
    key = serialization.load_der_private_key(connect.call_args.kwargs["private_key"], None)
    assert key.key_size == 2048
    assert "password" not in connect.call_args.kwargs


def test_wrong_passphrase_fails_without_quoting_the_key():
    adapter = SnowflakeAdapter(
        {
            "account": "xy12345",
            "user": "U",
            "auth_type": "keypair",
            "private_key": PEM,
            "private_key_passphrase": "wrong",
        }
    )
    with patch("snowflake.connector.connect") as connect:
        result = asyncio.run(adapter.test_connection())
    assert result["success"] is False
    assert "private key" in result["message"]
    assert "BEGIN" not in result["message"]
    connect.assert_not_called()


def test_bad_credentials_are_named():
    from snowflake.connector import errors

    adapter = SnowflakeAdapter({"account": "xy12345", "user": "U", "password": "x"})
    failure = errors.DatabaseError(msg="Incorrect username or password was specified.", errno=390100)
    with patch("snowflake.connector.connect", side_effect=failure):
        result = asyncio.run(adapter.test_connection())
    assert result == {"success": False, "message": "Incorrect username or password"}


def test_extract_schema_reads_tables_and_columns_in_two_queries():
    relations = [
        ("RAW", "CUSTOMERS", "BASE TABLE"),
        ("RAW", "V_CUSTOMERS", "VIEW"),
    ]
    columns = [
        ("RAW", "CUSTOMERS", "ID", "NUMBER", 1, "NO", None, 38, 0, "YES"),
        ("RAW", "CUSTOMERS", "NAME", "TEXT", 2, "YES", 256, None, None, "NO"),
        ("RAW", "V_CUSTOMERS", "ID", "NUMBER", 1, "YES", None, 38, 0, "NO"),
    ]
    conn, cursor = _mock_connection(relations, columns)
    adapter = SnowflakeAdapter(
        {"account": "xy12345", "user": "U", "password": "x", "database": "ANALYTICS"}
    )
    with patch("snowflake.connector.connect", return_value=conn):
        schema = asyncio.run(adapter.extract_schema())

    tables = {t["name"]: t for t in schema["tables"]}
    assert tables["CUSTOMERS"]["type"] == "TABLE"
    assert tables["V_CUSTOMERS"]["type"] == "VIEW"
    id_col, name_col = tables["CUSTOMERS"]["columns"]
    assert id_col["nullable"] is False and id_col["autoincrement"] is True
    assert id_col["precision"] == 38
    assert name_col["column_display_size"] == 256
    assert cursor.execute.call_count == 2
    conn.close.assert_called_once()


def test_extract_schema_needs_a_database():
    adapter = SnowflakeAdapter({"account": "xy12345", "user": "U", "password": "x"})
    with patch("snowflake.connector.connect") as connect:
        with pytest.raises(SnowflakeConfigError):
            asyncio.run(adapter.extract_schema())
    connect.assert_not_called()


def test_introspection_binds_schema_names():
    conn, cursor = _mock_connection([("T",)])
    adapter = SnowflakeAdapter({"account": "xy12345", "user": "U", "password": "x"})
    with patch("snowflake.connector.connect", return_value=conn):
        async def run():
            await adapter.connect()
            try:
                return await adapter._get_tables("RAW'; DROP TABLE X; --")
            finally:
                await adapter.disconnect()

        assert asyncio.run(run()) == ["T"]
    sql, params = cursor.execute.call_args.args
    assert "DROP" not in sql
    assert params == ("RAW'; DROP TABLE X; --",)


# -- ingest refuses clearly ---------------------------------------------------


def test_ingest_cannot_read_from_snowflake_yet():
    # The table picker answers with this list before it connects anywhere.
    assert "snowflake" not in supported_source_types()


def test_ingest_cannot_load_into_snowflake_yet():
    with pytest.raises(UnsupportedDestination, match="snowflake"):
        build_destination(
            "connection",
            lake=None,
            connection_type="snowflake",
            connection_config={},
            connection_secret="",
        )


def test_rendered_keypair_profile_is_what_dbt_snowflake_accepts():
    """Field names and the PEM-in-env shape, checked by dbt-snowflake itself."""
    from dbt.adapters.snowflake.connections import SnowflakeCredentials

    output = _profile_output(_row("keypair", secret=PEM, passphrase="ciphertext"))
    # What dbt's env_var() rendering does to the two placeholders.
    output["private_key"] = PEM
    output["private_key_passphrase"] = PASSPHRASE
    output.pop("type")
    credentials = SnowflakeCredentials.from_dict(output)
    args = credentials.auth_args()
    assert args["host"] == f"myorg-myaccount.{SNOWFLAKE_DOMAIN}"
    assert serialization.load_der_private_key(args["private_key"], None).key_size == 2048
    assert "password" not in args
