"""Structured run options: vars, empty, sample, event time, full refresh, selector.

The client sends fields; the server serialises each one into argv and refuses
what the subcommand cannot take. The option tables are checked against dbt's
own click definitions so they cannot drift from the pinned dbt version.
"""

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import click
import pytest
from pydantic import ValidationError

from app.exceptions import DbtOperationError
from app.models.dbt import CompileRequest, DbtCommand, ExplainRequest, PreviewRequest
from app.routers.sse import DbtCommandRequest
from app.services import command as command_module
from app.services.command import (
    MAX_VARS_BYTES,
    append_run_options,
    serialize_json_arg,
)
from app.services.dbt_service import DbtService

PROJECT_ID = "00000000-0000-4000-8000-00000000000a"


def _options(**fields):
    return SimpleNamespace(**fields)


def _dbt_command_options():
    from dbt.cli.main import cli

    table = {}

    def walk(group, prefix=""):
        for name, cmd in group.commands.items():
            full = f"{prefix} {name}".strip()
            if isinstance(cmd, click.Group):
                walk(cmd, full)
            else:
                table[full] = {opt for param in cmd.params for opt in getattr(param, "opts", [])}

    walk(cli)
    return table


@pytest.mark.parametrize(
    "commands,flag",
    [
        ("VARS_COMMANDS", "--vars"),
        ("EMPTY_COMMANDS", "--empty"),
        ("SAMPLE_COMMANDS", "--sample"),
        ("EVENT_TIME_COMMANDS", "--event-time-start"),
        ("EVENT_TIME_COMMANDS", "--event-time-end"),
        ("FULL_REFRESH_COMMANDS", "--full-refresh"),
        ("SELECTOR_COMMANDS", "--selector"),
    ],
)
def test_option_tables_match_dbts_own_cli(commands, flag):
    dbt_options = _dbt_command_options()
    configured = getattr(command_module, commands)
    for name in configured:
        if name in {"docs", "source"}:
            # Groups: every subcommand of `dbt docs` / `dbt source` takes --vars.
            members = [full for full in dbt_options if full.startswith(f"{name} ")]
            assert members and all(flag in dbt_options[full] for full in members)
            continue
        assert name in dbt_options, name
        assert flag in dbt_options[name], f"dbt {name} has no {flag}"

    # The command-specific tables are exact for the server's allowed leaf
    # commands. VARS_COMMANDS intentionally names the docs/source groups, whose
    # members are checked above, instead of every leaf separately.
    if commands != "VARS_COMMANDS":
        supported = {
            name
            for name, options in dbt_options.items()
            if flag in options
            and name.split()[0] in command_module.ALLOWED_DBT_SUBCOMMANDS
        }
        assert configured == supported


# ---- vars --------------------------------------------------------------------


def test_vars_become_one_json_argument():
    argv = append_run_options(["dbt", "run"], _options(vars={"day": "2024-01-01", "n": [1, 2]}))
    assert argv[:2] == ["dbt", "run"]
    assert argv[2] == "--vars"
    assert json.loads(argv[3]) == {"day": "2024-01-01", "n": [1, 2]}
    assert len(argv) == 4


def test_empty_vars_add_nothing():
    assert append_run_options(["dbt", "run"], _options(vars={})) == ["dbt", "run"]


@pytest.mark.parametrize(
    "argv",
    [
        ["dbt", "run", "--vars", "{a: 1}"],
        ["dbt", "run", "--vars={a: 1}"],
    ],
)
def test_client_vars_and_the_field_are_refused_together(argv):
    with pytest.raises(DbtOperationError, match="--vars"):
        append_run_options(argv, _options(vars={"a": 1}))
    # An empty object still counts as "the field was sent".
    with pytest.raises(DbtOperationError, match="--vars"):
        append_run_options(list(argv), _options(vars={}))


def test_client_vars_alone_still_pass():
    argv = ["dbt", "run", "--vars", "{a: 1}"]
    assert append_run_options(list(argv), _options()) == argv


@pytest.mark.parametrize(
    "value,message",
    [
        ({"x": object()}, "JSON-serialisable"),
        ({"x": float("nan")}, "JSON-serialisable"),
        ({"x": "a" * MAX_VARS_BYTES}, "larger than"),
        (["not", "an", "object"], "object"),
    ],
)
def test_vars_must_be_a_bounded_json_object(value, message):
    with pytest.raises(DbtOperationError, match=message):
        serialize_json_arg(value, name="vars", limit=MAX_VARS_BYTES)


def test_vars_field_is_an_object_in_every_request_model():
    for model, extra in (
        (DbtCommand, {"command": "run"}),
        (CompileRequest, {"model_path": "models/a.sql"}),
        (PreviewRequest, {"model_path": "models/a.sql"}),
        (ExplainRequest, {"model_path": "models/a.sql"}),
        (DbtCommandRequest, {"command": "run"}),
    ):
        with pytest.raises(ValidationError):
            model(project_id=PROJECT_ID, vars="a: 1", **extra)


# ---- run/build only flags ---------------------------------------------------


def test_empty_and_sample_on_build():
    argv = append_run_options(["dbt", "build"], _options(empty=True, sample=" 3 Days "))
    assert argv == ["dbt", "build", "--empty", "--sample", "3 day"]


@pytest.mark.parametrize("sample", ["3", "days", "3 weeks", "0 days", "-1 day", "3 days; rm", "1  day x"])
def test_sample_must_be_a_count_and_a_grain(sample):
    with pytest.raises(DbtOperationError, match="sample"):
        append_run_options(["dbt", "run"], _options(sample=sample))


@pytest.mark.parametrize(
    "fields",
    [
        {"empty": True},
        {"sample": "1 day"},
        {"event_time_start": "2024-01-01", "event_time_end": "2024-01-02"},
        {"full_refresh": True},
    ],
)
def test_run_build_options_are_refused_for_test(fields):
    with pytest.raises(DbtOperationError, match="not supported by dbt test"):
        append_run_options(["dbt", "test"], _options(**fields))


def test_event_times_are_normalised_to_utc():
    argv = append_run_options(
        ["dbt", "run"],
        _options(event_time_start="2024-01-01T02:00:00+02:00", event_time_end="2024-01-02"),
    )
    assert argv[2:] == [
        "--event-time-start",
        "2024-01-01T00:00:00",
        "--event-time-end",
        "2024-01-02T00:00:00",
    ]


@pytest.mark.parametrize(
    "fields,message",
    [
        ({"event_time_start": "2024-01-01"}, "together"),
        ({"event_time_end": "2024-01-01"}, "together"),
        ({"event_time_start": "2024-01-02", "event_time_end": "2024-01-01"}, "before"),
        ({"event_time_start": "yesterday", "event_time_end": "2024-01-01"}, "ISO 8601"),
    ],
)
def test_event_times_are_validated(fields, message):
    with pytest.raises(DbtOperationError, match=message):
        append_run_options(["dbt", "build"], _options(**fields))


def test_full_refresh_is_allowed_for_seed_and_not_repeated():
    assert append_run_options(["dbt", "seed"], _options(full_refresh=True)) == [
        "dbt",
        "seed",
        "--full-refresh",
    ]
    argv = ["dbt", "run", "--full-refresh"]
    assert append_run_options(list(argv), _options(full_refresh=True)) == argv


@pytest.mark.parametrize("flag", ["--empty", "--sample=1 day", "--event-time-start"])
def test_a_field_and_its_flag_in_the_command_are_refused(flag):
    fields = {"empty": True, "sample": "1 day"}
    fields.update(event_time_start="2024-01-01", event_time_end="2024-01-02")
    with pytest.raises(DbtOperationError, match="both as a field"):
        append_run_options(["dbt", "run", flag], _options(**fields))


# ---- selector ---------------------------------------------------------------


def _project_with_selectors(tmp_path: Path) -> Path:
    (tmp_path / "selectors.yml").write_text(
        "# nightly jobs\nselectors:\n  - name: nightly\n    definition: tag:nightly\n"
        "  - name: marts.core\n    definition: 'path:models/marts'\n"
    )
    return tmp_path


def test_selector_must_be_defined_in_selectors_yml(tmp_path):
    project = _project_with_selectors(tmp_path)
    argv = append_run_options(["dbt", "build"], _options(selector_name="nightly"), project_path=project)
    assert argv == ["dbt", "build", "--selector", "nightly"]
    assert append_run_options(
        ["dbt", "docs", "generate"], _options(selector_name="marts.core"), project_path=project
    )[-2:] == ["--selector", "marts.core"]
    with pytest.raises(DbtOperationError, match="no selector named 'weekly'"):
        append_run_options(["dbt", "build"], _options(selector_name="weekly"), project_path=project)


def test_selector_needs_a_selectors_file(tmp_path):
    with pytest.raises(DbtOperationError, match="no selectors.yml"):
        append_run_options(["dbt", "run"], _options(selector_name="nightly"), project_path=tmp_path)


@pytest.mark.parametrize("name", ["../x", "a b", "-x", "a;b", ""])
def test_selector_name_shape_is_checked(tmp_path, name):
    project = _project_with_selectors(tmp_path)
    if not name:
        # Empty means unset.
        assert append_run_options(["dbt", "run"], _options(selector_name=name), project_path=project) == ["dbt", "run"]
        return
    with pytest.raises(DbtOperationError, match="invalid selector name"):
        append_run_options(["dbt", "run"], _options(selector_name=name), project_path=project)


def test_selector_is_refused_for_run_operation_and_with_a_client_selector(tmp_path):
    project = _project_with_selectors(tmp_path)
    with pytest.raises(DbtOperationError, match="not supported"):
        append_run_options(["dbt", "run-operation", "m"], _options(selector_name="nightly"), project_path=project)
    with pytest.raises(DbtOperationError, match="both as a field"):
        append_run_options(
            ["dbt", "run", "--selector", "nightly"],
            _options(selector_name="nightly"),
            project_path=project,
        )


# ---- the command paths use it -----------------------------------------------


class _ProjectService:
    def __init__(self, path: Path):
        self.path = path

    def get_path_or_raise(self, _project_id: str) -> Path:
        return self.path


class _AsyncContext:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *_exc):
        return False


def _service(tmp_path: Path):
    service = DbtService(project_service=_ProjectService(tmp_path))
    run = AsyncMock(return_value=(0, "ok", ""))
    return service, run


@pytest.mark.asyncio
async def test_run_command_serialises_every_option(tmp_path):
    project = _project_with_selectors(tmp_path)
    service, run = _service(project)
    request = DbtCommand(
        project_id=PROJECT_ID,
        command="build",
        vars={"n": 3},
        empty=True,
        sample="2 days",
        event_time_start="2024-01-01T00:00:00Z",
        event_time_end="2024-01-02T00:00:00Z",
        full_refresh=True,
        selector_name="nightly",
    )
    with (
        patch("app.services.dbt_service.global_run_semaphore", return_value=_AsyncContext()),
        patch("app.services.dbt_service.AsyncFileLock.lock", return_value=_AsyncContext()),
        patch.object(service, "_run_dbt_command", run),
    ):
        result = await service.run_command(request)
    assert result["success"]
    argv = run.await_args.args[0]
    assert argv[argv.index("--vars") + 1] == '{"n":3}'
    assert argv[argv.index("--sample") + 1] == "2 day"
    assert argv[argv.index("--event-time-start") + 1] == "2024-01-01T00:00:00"
    assert argv[argv.index("--selector") + 1] == "nightly"
    assert "--empty" in argv and "--full-refresh" in argv
    # Server-owned flags still come last and exactly once.
    assert argv.count("--profiles-dir") == 1


@pytest.mark.asyncio
async def test_run_command_refuses_before_running(tmp_path):
    service, run = _service(tmp_path)
    with patch.object(service, "_run_dbt_command", run):
        with pytest.raises(DbtOperationError, match="--vars"):
            await service.run_command(
                DbtCommand(project_id=PROJECT_ID, command="run --vars '{a: 1}'", vars={"a": 2})
            )
    run.assert_not_awaited()


@pytest.mark.asyncio
async def test_compile_and_preview_pass_vars(tmp_path):
    service, run = _service(tmp_path)
    with (
        patch("app.services.dbt_service.AsyncFileLock.lock", return_value=_AsyncContext()),
        patch.object(service, "_run_dbt_command", run),
    ):
        await service.compile_model(
            CompileRequest(project_id=PROJECT_ID, model_path="models/a.sql", vars={"d": "x"})
        )
        compile_argv = run.await_args.args[0]
        run.return_value = (0, "[]", "")
        await service.preview_model(
            PreviewRequest(project_id=PROJECT_ID, model_path="models/a.sql", vars={"d": "y"})
        )
        preview_argv = run.await_args.args[0]
    assert compile_argv[compile_argv.index("--vars") + 1] == '{"d":"x"}'
    assert preview_argv[:2] == ["dbt", "show"]
    assert preview_argv[preview_argv.index("--vars") + 1] == '{"d":"y"}'


@pytest.mark.asyncio
async def test_launcher_refuses_a_bad_option_before_a_history_row(tmp_path):
    from app.services.run_launcher import launch_dbt_run

    project_service = AsyncMock()
    project_service.get_or_sync = AsyncMock(return_value=tmp_path)
    insert = AsyncMock()
    with (
        patch("app.services.run_launcher.ProjectService", return_value=project_service),
        patch("app.services.run_launcher.DbtService._insert_run_start", insert),
    ):
        with pytest.raises(DbtOperationError, match="sample"):
            await launch_dbt_run(
                DbtCommand(project_id=PROJECT_ID, command="run", sample="lots"),
                "user-1",
                session=object(),
            )
    insert.assert_not_awaited()


def test_sse_body_accepts_the_same_options():
    body = DbtCommandRequest(command="build", vars={"a": 1}, selector_name="nightly", empty=True)
    argv = append_run_options(["dbt", "build"], body)
    assert argv == ["dbt", "build", "--vars", '{"a":1}', "--empty", "--selector", "nightly"]
