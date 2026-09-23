"""dbt ls, dbt debug, macros / run-operation and init templates."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.exceptions import DbtOperationError
from app.models.dbt import DbtDebugRequest, DbtInitRequest, DbtLsRequest, DbtRunOperationRequest
from app.services import dbt_cli
from app.services.dbt_service import DbtService

PROJECT_ID = "00000000-0000-4000-8000-00000000000a"


class _ProjectService:
    def __init__(self, path: Path):
        self.path = path

    def get_path_or_raise(self, _project_id: str) -> Path:
        return self.path

    def ensure_exists(self, _project_id: str) -> Path:
        return self.path


class _AsyncContext:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *_exc):
        return False


@pytest.fixture
def service(tmp_path):
    svc = DbtService(project_service=_ProjectService(tmp_path))
    with patch("app.services.dbt_service.AsyncFileLock.lock", return_value=_AsyncContext()):
        yield svc


# ---- dbt ls -----------------------------------------------------------------

LS_STDOUT = "\n".join(
    [
        "\x1b[0m08:37:35  Running with dbt=1.10.23",
        "\x1b[0m08:37:35  Found 2 models, 1 source",
        json.dumps(
            {
                "name": "orders",
                "resource_type": "model",
                "package_name": "shop",
                "original_file_path": "models/orders.sql",
                "unique_id": "model.shop.orders",
                "alias": "orders",
                "config": {"materialized": "table", "enabled": True, "post-hook": []},
                "tags": ["daily"],
                "depends_on": {"macros": [], "nodes": ["source.shop.raw.orders"]},
            }
        ),
        json.dumps(
            {
                "name": "orders",
                "resource_type": "source",
                "package_name": "shop",
                "source_name": "raw",
                "unique_id": "source.shop.raw.orders",
            }
        ),
        "{not json",
    ]
)


def test_ls_output_is_parsed_from_json_lines_among_logs():
    parsed = dbt_cli.parse_ls_output(LS_STDOUT)
    assert parsed["count"] == 2 and not parsed["truncated"]
    model, source = parsed["rows"]
    assert model["unique_id"] == "model.shop.orders"
    assert model["config"] == {"materialized": "table", "enabled": True}
    assert model["depends_on"] == ["source.shop.raw.orders"]
    assert source["source_name"] == "raw" and source["tags"] == []


def test_ls_output_is_capped():
    line = json.dumps({"unique_id": "model.a.b", "name": "b"})
    parsed = dbt_cli.parse_ls_output("\n".join([line] * (dbt_cli.LS_MAX_ROWS + 3)))
    assert parsed["count"] == dbt_cli.LS_MAX_ROWS and parsed["truncated"]


def test_unknown_resource_types_are_refused():
    assert dbt_cli.validate_resource_types(["Model", "source"]) == ["model", "source"]
    with pytest.raises(DbtOperationError, match="unknown resource type"):
        dbt_cli.validate_resource_types(["model", "--project-dir"])


def test_ls_resource_types_match_dbts_own_cli():
    from dbt.cli.main import cli

    parameter = next(
        item for item in cli.commands["ls"].params if "--resource-type" in item.opts
    )
    assert dbt_cli.LS_RESOURCE_TYPES == frozenset(parameter.type.choices)


@pytest.mark.asyncio
async def test_ls_builds_json_argv_and_returns_rows(service):
    run = AsyncMock(return_value=(0, LS_STDOUT, ""))
    with patch.object(service, "_run_dbt_command", run):
        result = await service.list_resources(
            DbtLsRequest(
                project_id=PROJECT_ID,
                select="tag:daily",
                exclude="orders_v1",
                resource_types=["model", "source"],
                target="prod",
                vars={"d": 1},
            )
        )
    argv = run.await_args.args[0]
    assert argv[:4] == ["dbt", "ls", "--output", "json"]
    assert argv[argv.index("--select") + 1] == "tag:daily"
    assert argv[argv.index("--exclude") + 1] == "orders_v1"
    assert [argv[i + 1] for i, t in enumerate(argv) if t == "--resource-type"] == ["model", "source"]
    assert argv[argv.index("--target") + 1] == "prod"
    assert argv[argv.index("--vars") + 1] == '{"d":1}'
    assert result["success"] and result["count"] == 2 and result["error"] is None


@pytest.mark.asyncio
async def test_ls_refuses_client_path_flags_in_select(service):
    run = AsyncMock(return_value=(0, "", ""))
    with patch.object(service, "_run_dbt_command", run):
        with pytest.raises(DbtOperationError):
            await service.list_resources(DbtLsRequest(project_id=PROJECT_ID, target="../x"))
    run.assert_not_awaited()


# ---- dbt debug --------------------------------------------------------------


def test_redaction_removes_env_secrets_profile_literals_and_paths(tmp_path):
    (tmp_path / "profiles.yml").write_text(
        "p:\n  outputs:\n    dev:\n      type: dremio\n      pat: literal-pat-123\n      user: bob\n"
    )
    output = (
        f"\x1b[0mUsing profiles dir at {tmp_path}\n"
        "  pat: literal-pat-123\n"
        "  password: from-env-secret\n"
        "  user: bob\n"
    )
    cleaned = dbt_cli.redact_output(
        output, secrets=["from-env-secret", "x", ""], project_path=tmp_path
    )
    assert "literal-pat-123" not in cleaned
    assert "from-env-secret" not in cleaned
    assert str(tmp_path) not in cleaned and "<project>" in cleaned
    assert "\x1b[" not in cleaned
    # Short values are not treated as secrets, or every "1" would vanish.
    assert "user: bob" in cleaned


@pytest.mark.asyncio
async def test_debug_output_never_carries_the_profile_secret(service, tmp_path):
    secret = "Sup3r-Secret-Warehouse-Pw"

    async def environment(*_args, **_kwargs):
        return {"DBT_ENV_SECRET_DBT_CRAFT_CREDENTIAL": secret}

    run = AsyncMock(
        return_value=(1, f"Connection:\n  password: {secret}\n", f"auth failed for {secret}")
    )
    with (
        patch.object(service, "_build_dbt_environment", environment),
        patch.object(service, "_run_dbt_command", run),
    ):
        result = await service.debug_project(DbtDebugRequest(project_id=PROJECT_ID, target="prod"))
    assert run.await_args.args[0][:4] == ["dbt", "debug", "--target", "prod"]
    assert run.await_args.kwargs["env"]["DBT_ENV_SECRET_DBT_CRAFT_CREDENTIAL"] == secret
    assert result["success"] is False
    assert secret not in result["output"]
    assert dbt_cli.REDACTED in result["output"]


# ---- macros / run-operation -------------------------------------------------


def _manifest(tmp_path: Path) -> dict:
    manifest = {
        "metadata": {"project_name": "shop", "generated_at": "2026-01-01T00:00:00Z"},
        "macros": {
            "macro.shop.grant_select": {
                "name": "grant_select",
                "package_name": "shop",
                "original_file_path": "macros/grants.sql",
                "description": "Grant read access",
                "arguments": [{"name": "role", "type": "string", "description": "who"}],
                "macro_sql": "{% macro grant_select(role, schemas=['a', 'b'], dry=false) %}...{% endmacro %}",
            },
            "macro.dbt_utils.star": {
                "name": "star",
                "package_name": "dbt_utils",
                "macro_sql": "{%- macro star(from, relation_alias=False) -%}{%- endmacro -%}",
            },
            "macro.dbt.run_query": {
                "name": "run_query",
                "package_name": "dbt",
                "macro_sql": "{% macro run_query(sql) %}{% endmacro %}",
            },
        },
    }
    (tmp_path / "target").mkdir(exist_ok=True)
    (tmp_path / "target" / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "dbt_packages" / "dbt_utils").mkdir(parents=True, exist_ok=True)
    return manifest


def test_macro_signature_reads_names_and_defaults():
    assert dbt_cli.macro_signature(
        "{% macro grant_select(role, schemas=['a', 'b'], dry=false) %}", "grant_select"
    ) == [
        {"name": "role", "default": None},
        {"name": "schemas", "default": "['a', 'b']"},
        {"name": "dry", "default": "false"},
    ]
    assert dbt_cli.macro_signature("{% macro other() %}", "grant_select") == []


def test_macro_list_leaves_out_dbt_internals_unless_asked(tmp_path):
    manifest = _manifest(tmp_path)
    names = [m["name"] for m in dbt_cli.list_macros(manifest, tmp_path)]
    assert names == ["star", "grant_select"]
    everything = dbt_cli.list_macros(manifest, tmp_path, include_internal=True)
    assert {m["name"] for m in everything} == {"star", "grant_select", "run_query"}
    grant = next(m for m in everything if m["name"] == "grant_select")
    assert grant["arguments"] == [{"name": "role", "type": "string", "description": "who"}]
    assert [a["name"] for a in grant["signature"]] == ["role", "schemas", "dry"]


def test_run_operation_macro_must_be_in_the_manifest(tmp_path):
    manifest = _manifest(tmp_path)
    assert dbt_cli.require_macro(manifest, "grant_select") == "grant_select"
    assert dbt_cli.require_macro(manifest, "dbt_utils.star") == "dbt_utils.star"
    for bad, message in (
        ("drop_everything", "no macro named"),
        ("shop.star", "no macro named"),
        ("star --args x", "invalid macro name"),
        ("../x", "invalid macro name"),
    ):
        with pytest.raises(DbtOperationError, match=message):
            dbt_cli.require_macro(manifest, bad)
    with pytest.raises(DbtOperationError, match="no manifest"):
        dbt_cli.require_macro(None, "grant_select")


@pytest.mark.asyncio
async def test_run_operation_goes_through_run_command_with_json_args(service, tmp_path):
    _manifest(tmp_path)
    run_command = AsyncMock(return_value={"success": True})
    with patch.object(service, "run_command", run_command):
        await service.run_operation(
            DbtRunOperationRequest(
                project_id=PROJECT_ID,
                macro="grant_select",
                args={"role": "analyst", "dry": True},
                vars={"env": "prod"},
                target="prod",
            )
        )
    command = run_command.await_args.args[0]
    assert command.command == "run-operation"
    assert command.flags[0] == "grant_select"
    assert command.flags[1] == "--args"
    assert json.loads(command.flags[2]) == {"role": "analyst", "dry": True}
    assert command.vars == {"env": "prod"} and command.target == "prod"


@pytest.mark.asyncio
async def test_run_operation_refuses_an_unknown_macro_before_running(service, tmp_path):
    _manifest(tmp_path)
    run_command = AsyncMock()
    with patch.object(service, "run_command", run_command):
        with pytest.raises(DbtOperationError, match="no macro named"):
            await service.run_operation(
                DbtRunOperationRequest(project_id=PROJECT_ID, macro="nope")
            )
        with pytest.raises(DbtOperationError, match="larger than"):
            await service.run_operation(
                DbtRunOperationRequest(
                    project_id=PROJECT_ID, macro="grant_select", args={"x": "a" * 20000}
                )
            )
    run_command.assert_not_awaited()


# ---- init -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_init_accepts_only_allowlisted_templates(service, tmp_path):
    run = AsyncMock(return_value=(0, "", ""))
    with patch.object(service, "_run_dbt_command", run):
        with pytest.raises(DbtOperationError, match="unknown template"):
            await service.init_project(
                DbtInitRequest(project_id=PROJECT_ID, project_name="shop", template="../../etc")
            )
        run.assert_not_awaited()
        with patch.object(service, "_placeholder_profiles_yml", return_value="x: {}\n"):
            result = await service.init_project(
                DbtInitRequest(project_id=PROJECT_ID, project_name="shop")
            )
    assert result["success"]
    assert run.await_args.args[0] == ["dbt", "init", "shop", "--skip-profile-setup"]
