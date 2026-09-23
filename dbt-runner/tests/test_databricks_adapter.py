import asyncio
import ipaddress
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters import ADAPTERS, get_adapter, list_adapters
from adapters.databricks import (
    AUTH_OAUTH_M2M,
    DATABRICKS_PORT,
    DatabricksAdapter,
    DatabricksConfigError,
    normalize_http_path,
    normalize_workspace_host,
)
from app.core.host_guard import HostNotAllowed
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
    DbtOperationError,
    DbtService,
    build_adapter_config_from_connection_row,
    build_adapter_config_with_secrets,
)
from ingest.destination import UnsupportedDestination, build_destination
from ingest.sql_source import supported_source_types

HOST = "adb-1234567890123456.7.azuredatabricks.net"
HTTP_PATH = "/sql/1.0/warehouses/1abc2d3456e7f890"
TOKEN = "dapi-personal-access-token"
CLIENT_ID = "11111111-2222-3333-4444-555555555555"
CLIENT_SECRET = "dose-oauth-client-secret"


def _row(auth_type="pat", secret=TOKEN, client_secret=None, **extra):
    extra_config = {
        "auth_type": auth_type,
        "http_path": HTTP_PATH,
        "schema": "dbt_dev",
        **extra,
    }
    if auth_type == AUTH_OAUTH_M2M:
        extra_config.setdefault("client_id", CLIENT_ID)
    if client_secret:
        extra_config[SECONDARY_SECRET_KEY] = client_secret
    return {
        "connection_type": "databricks",
        "host": HOST,
        "port": DATABRICKS_PORT,
        "database": "analytics",
        "username": "",
        "password_encrypted": secret,
        "extra_config": extra_config,
    }


def _profile_output(row) -> dict:
    conn_type, config, needs_secret = build_adapter_config_from_connection_row(row)
    rendered = yaml.safe_load(
        get_adapter(conn_type, config).generate_profiles_yml("proj")
    )
    return rendered["proj"]["outputs"]["dev"], needs_secret


# -- workspace hostname and compute path -------------------------------------


@pytest.mark.parametrize(
    "host, expected",
    [
        (
            "dbc-a1b2c3d4-e5f6.cloud.databricks.com",
            "dbc-a1b2c3d4-e5f6.cloud.databricks.com",
        ),
        (
            "dbc-abc.staging.cloud.databricks.com",
            "dbc-abc.staging.cloud.databricks.com",
        ),
        (HOST.upper(), HOST),
        (
            "1234567890123456.7.gcp.databricks.com",
            "1234567890123456.7.gcp.databricks.com",
        ),
        ("  workspace.cloud.databricks.com  ", "workspace.cloud.databricks.com"),
    ],
)
def test_valid_workspace_hostnames(host, expected):
    assert normalize_workspace_host(host) == expected


@pytest.mark.parametrize(
    "host",
    [
        "",
        None,
        "https://workspace.cloud.databricks.com",
        "workspace.cloud.databricks.com:443",
        "workspace.cloud.databricks.com/path",
        "workspace.cloud.databricks.com?o=1",
        "user@workspace.cloud.databricks.com",
        "workspace.cloud.databricks.com.evil.example",
        "cloud.databricks.com",
        "azuredatabricks.net",
        "gcp.databricks.com",
        "workspace.databricks.com",
        "work_space.cloud.databricks.com",
        "work space.cloud.databricks.com",
        "workspace\n.evil.cloud.databricks.com",
        ".workspace.cloud.databricks.com",
        "workspace..cloud.databricks.com",
        "-workspace.cloud.databricks.com",
        f"{'x' * 64}.cloud.databricks.com",
        f"{'x.' * 125}x.cloud.databricks.com",
    ],
)
def test_invalid_workspace_hostnames_are_refused(host):
    with pytest.raises(DatabricksConfigError):
        normalize_workspace_host(host)


@pytest.mark.parametrize(
    "http_path",
    [
        HTTP_PATH,
        "/sql/protocolv1/o/1234567890123456/1234-567890-test123",
        "/sql/protocolv1/o/1/12abc567",
    ],
)
def test_valid_http_paths(http_path):
    assert normalize_http_path(http_path) == http_path


@pytest.mark.parametrize(
    "http_path",
    [
        "",
        None,
        "sql/1.0/warehouses/1abc2d3456e7f890",
        "/sql/1.0/warehouses/too-short",
        "/sql/1.0/warehouses/1abc2d3456e7f890/extra",
        "/sql/1.0/warehouses/1abc2d3456e7f890?o=1",
        "/sql/1.0/endpoints/1abc2d3456e7f890",
        "/sql/protocolv1/o/not-numeric/1234-567890-test123",
        "/sql/protocolv1/o/123/",
        "/sql/protocolv1/o/123/cluster/id",
        "/sql/protocolv1/o/123/cluster?id=evil",
        "/sql/protocolv1/o/123/cluster name",
        "https://workspace.cloud.databricks.com/sql/1.0/warehouses/1abc2d3456e7f890",
    ],
)
def test_invalid_http_paths_are_refused(http_path):
    with pytest.raises(DatabricksConfigError):
        normalize_http_path(http_path)


# -- registry and host guard --------------------------------------------------


def test_registry_lists_databricks():
    assert ADAPTERS["databricks"] is DatabricksAdapter
    assert list_adapters()["databricks"] == "DatabricksAdapter"
    assert isinstance(get_adapter("databricks", {"host": HOST}), DatabricksAdapter)


def test_host_guard_checks_the_validated_workspace_host():
    with patch("app.services.connection_targets.assert_host_allowed") as guard:
        assert_connection_target_allowed(
            "databricks", {"host": HOST.upper(), "port": 1234}
        )
    guard.assert_called_once_with(HOST, DATABRICKS_PORT)


def test_host_guard_refuses_an_invalid_workspace_hostname():
    with patch("app.services.connection_targets.assert_host_allowed") as guard:
        with pytest.raises(HostNotAllowed):
            assert_connection_target_allowed(
                "databricks", {"host": "https://workspace.cloud.databricks.com"}
            )
    guard.assert_not_called()


def test_host_guard_refuses_a_workspace_that_resolves_to_loopback():
    with patch(
        "app.core.host_guard._resolve",
        return_value=[ipaddress.ip_address("127.0.0.1")],
    ):
        with pytest.raises(HostNotAllowed):
            assert_connection_target_allowed("databricks", {"host": HOST})


def test_connection_test_route_refuses_before_connecting():
    from app.models.connection import ConnectionTestRequest
    from app.routers.connection import test_connection as route

    request = ConnectionTestRequest(
        type="databricks",
        name="bad",
        config={"host": "https://evil.example", "http_path": HTTP_PATH},
    )
    with patch("databricks.sql.connect") as connect:
        result = asyncio.run(route(request, claims={}))
    assert result["success"] is False
    assert "workspace hostname" in result["message"]
    connect.assert_not_called()


# -- profile rendering --------------------------------------------------------


def test_pat_profile_uses_the_main_secret_env_var():
    output, needs_secret = _profile_output(_row())
    assert needs_secret is True
    assert output == {
        "type": "databricks",
        "host": HOST,
        "http_path": HTTP_PATH,
        "schema": "dbt_dev",
        "threads": 4,
        "catalog": "analytics",
        "token": DBT_PROFILE_SECRET_PLACEHOLDER,
    }


def test_oauth_profile_uses_only_the_secondary_secret_slot():
    output, needs_secret = _profile_output(
        _row(AUTH_OAUTH_M2M, secret="unused-main", client_secret="ciphertext")
    )
    assert needs_secret is False
    assert output["auth_type"] == "oauth"
    assert output["client_id"] == CLIENT_ID
    assert output["client_secret"] == DBT_PROFILE_SECONDARY_SECRET_PLACEHOLDER
    assert "token" not in output
    assert SECONDARY_SECRET_KEY not in output


def test_oauth_profile_needs_the_secondary_secret():
    _, config, _ = build_adapter_config_from_connection_row(
        _row(AUTH_OAUTH_M2M, secret=None, client_secret=None)
    )
    with pytest.raises(DatabricksConfigError, match="client_secret"):
        get_adapter("databricks", config).generate_profiles_yml("proj")


def test_only_documented_fields_reach_the_profile():
    output, _ = _profile_output(
        _row(
            threads="8",
            oauth_redirect_url="https://evil.example/callback",
            proxy_host="127.0.0.1",
            http_headers={"Authorization": "leak"},
            connection_parameters={"server_hostname": "evil.example"},
            session_properties={"spark.secret": "leak"},
            use_ssl=False,
            insecure=True,
        )
    )
    assert output["threads"] == 8
    for key in (
        "oauth_redirect_url",
        "proxy_host",
        "http_headers",
        "connection_parameters",
        "session_properties",
        "use_ssl",
        "insecure",
    ):
        assert key not in output


@pytest.mark.parametrize(
    "change",
    [
        {"host": "workspace.example.com"},
        {"extra_config": {"http_path": "/evil", "schema": "s"}},
        {"extra_config": {"http_path": HTTP_PATH}},
    ],
)
def test_profile_refuses_an_unusable_target(change):
    row = {**_row(), **change}
    _, config, _ = build_adapter_config_from_connection_row(row)
    with pytest.raises(DatabricksConfigError):
        get_adapter("databricks", config).generate_profiles_yml("proj")


def test_values_cannot_break_out_of_the_yaml():
    row = _row()
    row["database"] = "analytics\nevil: true"
    row["extra_config"]["schema"] = "dbt_dev\n  token: leaked"
    output, _ = _profile_output(row)
    assert output["catalog"] == "analytics\nevil: true"
    assert output["schema"] == "dbt_dev\n  token: leaked"
    assert "evil" not in output


def test_direct_config_carries_oauth_secrets_in_the_right_fields():
    row = _row(AUTH_OAUTH_M2M, secret="unused-main", client_secret=CLIENT_SECRET)
    with patch(
        "app.services.dbt_service.decrypt_secret_or_plaintext",
        side_effect=lambda value: value or "",
    ):
        conn_type, config = build_adapter_config_with_secrets(row)
    assert conn_type == "databricks"
    assert config["client_id"] == CLIENT_ID
    assert config["client_secret"] == CLIENT_SECRET
    assert "token" not in config


def test_diagnostic_preview_redacts_databricks_credentials():
    content = yaml.safe_dump(
        {
            "p": {
                "outputs": {
                    "pat": {"token": TOKEN},
                    "oauth": {"client_secret": CLIENT_SECRET},
                }
            }
        }
    )
    redacted = _redact_profiles_yml(content)
    assert TOKEN not in redacted and CLIENT_SECRET not in redacted
    assert redacted.count("'***REDACTED***'") == 2


@pytest.mark.parametrize("auth_type", ["pat", AUTH_OAUTH_M2M])
def test_rendered_profile_is_accepted_by_dbt_databricks(auth_type):
    from dbt.adapters.databricks.credentials import (
        DatabricksCredentialManager,
        DatabricksCredentials,
    )

    row = (
        _row()
        if auth_type == "pat"
        else _row(AUTH_OAUTH_M2M, secret=None, client_secret="ciphertext")
    )
    output, _ = _profile_output(row)
    output.pop("type")
    output.pop("threads")
    if auth_type == "pat":
        output["token"] = TOKEN
    else:
        output["client_secret"] = CLIENT_SECRET
    with patch.object(
        DatabricksCredentialManager, "create_from", return_value=MagicMock()
    ):
        credentials = DatabricksCredentials.from_dict(output)
    credentials.validate_creds()
    assert credentials.host == HOST
    assert credentials.http_path == HTTP_PATH


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
    with (
        patch(
            "app.services.dbt_service.decrypt_secret_or_plaintext",
            side_effect=lambda value: value or "",
        ),
        patch.object(DbtService, "_resolve_lakehouse", AsyncMock(return_value=lake)),
        patch(
            "app.services.dbt_service.lakehouse.dbt_attach_entry",
            return_value={"path": "ducklake:x", "alias": "lake"},
        ),
        patch("app.services.dbt_service.lakehouse.catalog_password", return_value=""),
        patch(
            "app.services.dbt_service.duckdb_resources.profile_settings",
            return_value={"memory_limit": "1GB"},
        ),
        patch("app.services.dbt_service.warm_worker_pool.release_project", AsyncMock()),
    ):
        env = asyncio.run(
            DbtService._regenerate_profiles_from_db(session, "pid", tmp_path)
        )
    written = (tmp_path / "profiles.yml").read_text()
    return yaml.safe_load(written)["proj"], env, written


def test_secrets_reach_dbt_through_target_specific_env_vars(tmp_path):
    connections = {
        DEV_ID: _row(),
        PROD_ID: _row(
            AUTH_OAUTH_M2M, secret="unused-main", client_secret=CLIENT_SECRET
        ),
    }
    profile, env, written = _regenerate(
        tmp_path, connections, [{"name": "prod", "connection_id": PROD_ID}]
    )

    assert env[DBT_PROFILE_SECRET_ENV] == TOKEN
    assert f"{DBT_PROFILE_SECRET_ENV}__PROD" not in env
    assert env[f"{DBT_PROFILE_SECONDARY_SECRET_ENV}__PROD"] == CLIENT_SECRET
    assert DBT_PROFILE_SECONDARY_SECRET_ENV not in env

    dev, prod = profile["outputs"]["dev"], profile["outputs"]["prod"]
    assert DBT_PROFILE_SECRET_ENV in dev["token"]
    assert f"{DBT_PROFILE_SECONDARY_SECRET_ENV}__PROD" in prod["client_secret"]
    assert "token" not in prod
    for secret in (TOKEN, CLIENT_SECRET, "unused-main"):
        assert secret not in written


def test_duckdb_only_features_stay_off_for_databricks_targets(tmp_path):
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


def test_a_lake_on_a_databricks_only_project_is_refused_by_name(tmp_path):
    with pytest.raises(DbtOperationError) as raised:
        _regenerate(
            tmp_path,
            {DEV_ID: _row()},
            lake=SimpleNamespace(catalog_url="postgresql://lakehost/cat"),
        )
    assert "databricks" in raised.value.message


# -- adapter methods, connector mocked ----------------------------------------


def _mock_connection(*results):
    conn = MagicMock()
    cursor = conn.cursor.return_value
    cursor.fetchall.side_effect = list(results)
    return conn, cursor


def test_pat_connection_pins_host_path_and_reports_the_session():
    conn, _ = _mock_connection(
        [("analytics", "dbt_dev", "user@example.com", "Spark 3.5")]
    )
    adapter = DatabricksAdapter(
        {
            "host": HOST.upper(),
            "http_path": HTTP_PATH,
            "token": TOKEN,
            "catalog": "analytics",
            "schema": "dbt_dev",
        }
    )
    with patch("databricks.sql.connect", return_value=conn) as connect:
        result = asyncio.run(adapter.test_connection())

    assert result["success"] is True
    assert result["details"]["version"] == "Spark 3.5"
    kwargs = connect.call_args.kwargs
    assert kwargs == {
        "server_hostname": HOST,
        "http_path": HTTP_PATH,
        "catalog": "analytics",
        "schema": "dbt_dev",
        "access_token": TOKEN,
    }
    conn.close.assert_called_once()


def test_oauth_connection_builds_an_m2m_credentials_provider():
    conn, _ = _mock_connection([("analytics", "dbt_dev", "sp", "Spark")])
    adapter = DatabricksAdapter(
        {
            "host": HOST,
            "http_path": HTTP_PATH,
            "auth_type": AUTH_OAUTH_M2M,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "schema": "dbt_dev",
        }
    )
    sdk_config = object()
    headers = MagicMock()
    with (
        patch("databricks.sql.connect", return_value=conn) as connect,
        patch("databricks.sdk.core.Config", return_value=sdk_config) as config,
        patch(
            "databricks.sdk.core.oauth_service_principal", return_value=headers
        ) as oauth,
    ):
        result = asyncio.run(adapter.test_connection())

    assert result["success"] is True
    config.assert_called_once_with(
        host=f"https://{HOST}",
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        auth_type="oauth-m2m",
    )
    kwargs = connect.call_args.kwargs
    assert "access_token" not in kwargs
    assert "client_secret" not in kwargs
    assert kwargs["credentials_provider"]() is headers
    oauth.assert_called_once_with(sdk_config)


@pytest.mark.parametrize(
    "error, expected",
    [
        (RuntimeError("HTTP 401 unauthorized"), "Databricks authentication failed"),
        (
            RuntimeError("403 forbidden"),
            "Databricks rejected the credentials or permissions",
        ),
        (RuntimeError("connection timed out"), "Cannot reach the Databricks workspace"),
        (
            RuntimeError("warehouse endpoint gone"),
            "The Databricks HTTP path was not found or is unavailable",
        ),
        (RuntimeError(TOKEN), "Databricks connection failed"),
    ],
)
def test_connection_errors_are_bounded_and_do_not_echo_secrets(error, expected):
    adapter = DatabricksAdapter({"host": HOST, "http_path": HTTP_PATH, "token": TOKEN})
    with patch("databricks.sql.connect", side_effect=error):
        result = asyncio.run(adapter.test_connection())
    assert result == {"success": False, "message": expected}
    assert TOKEN not in result["message"]


def test_extract_schema_reads_relations_and_columns_in_two_queries():
    relations = [
        ("raw", "customers", "MANAGED"),
        ("raw", "v_customers", "VIEW"),
        ("raw", "mv_customers", "MATERIALIZED_VIEW"),
    ]
    columns = [
        ("raw", "customers", "id", "BIGINT", "BIGINT", 1, "NO", None, 19, 0),
        ("raw", "customers", "name", "STRING", "STRING", 2, "YES", 255, None, None),
        ("raw", "v_customers", "id", "BIGINT", "BIGINT", 1, "YES", None, 19, 0),
    ]
    conn, cursor = _mock_connection(relations, columns)
    adapter = DatabricksAdapter(
        {"host": HOST, "http_path": HTTP_PATH, "token": TOKEN, "catalog": "analytics"}
    )
    with patch("databricks.sql.connect", return_value=conn):
        schema = asyncio.run(adapter.extract_schema())

    tables = {table["name"]: table for table in schema["tables"]}
    assert tables["customers"]["type"] == "TABLE"
    assert tables["v_customers"]["type"] == "VIEW"
    assert tables["mv_customers"]["type"] == "VIEW"
    id_col, name_col = tables["customers"]["columns"]
    assert id_col["nullable"] is False and id_col["precision"] == 19
    assert name_col["nullable"] is True and name_col["column_display_size"] == 255
    assert cursor.execute.call_count == 2
    assert all(
        "information_schema" in call.args[0] for call in cursor.execute.call_args_list
    )
    conn.close.assert_called_once()


def test_introspection_binds_schema_names():
    conn, cursor = _mock_connection([("customers",)])
    adapter = DatabricksAdapter({"host": HOST, "http_path": HTTP_PATH, "token": TOKEN})
    with patch("databricks.sql.connect", return_value=conn):

        async def run():
            await adapter.connect()
            try:
                return await adapter._get_tables("raw'; DROP TABLE x; --")
            finally:
                await adapter.disconnect()

        assert asyncio.run(run()) == ["customers"]
    sql, params = cursor.execute.call_args.args
    assert "DROP" not in sql
    assert params == ("raw'; DROP TABLE x; --",)


# -- ingest refuses clearly ---------------------------------------------------


def test_ingest_cannot_read_from_databricks_yet():
    assert "databricks" not in supported_source_types()


def test_ingest_cannot_load_into_databricks_yet():
    with pytest.raises(UnsupportedDestination, match="databricks"):
        build_destination(
            "connection",
            lake=None,
            connection_type="databricks",
            connection_config={},
            connection_secret="",
        )
