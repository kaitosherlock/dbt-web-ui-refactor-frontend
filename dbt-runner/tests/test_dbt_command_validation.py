"""Client dbt commands cannot choose commands or filesystem locations."""

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.exceptions import DbtOperationError
from app.models.dbt import (
    CompileRequest,
    DbtCommand,
    ExplainRequest,
    PreviewRequest,
    QueryRequest,
)
from app.routers.sse import DbtCommandRequest, dbt_sse
from app.services.command import DBT_PATH_FLAGS, validate_dbt_argv
from app.services.dbt_service import DbtService
from app.services.run_launcher import launch_dbt_run


class DbtArgvValidationTest(unittest.TestCase):
    def test_refuses_every_filesystem_path_flag_in_both_cli_forms(self):
        for flag in DBT_PATH_FLAGS:
            for arguments in ([flag, "/other/project"], [f"{flag}=/other/project"]):
                with self.subTest(flag=flag, arguments=arguments):
                    with self.assertRaises(DbtOperationError) as raised:
                        validate_dbt_argv(["dbt", "run", *arguments])
                    self.assertEqual(raised.exception.status_code, 400)
                    self.assertIn(flag, raised.exception.message)
                    self.assertIn("managed by the server", raised.exception.message)

    def test_refuses_unknown_subcommand(self):
        with self.assertRaises(DbtOperationError) as raised:
            validate_dbt_argv(["dbt", "arbitrary-command"])
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("arbitrary-command", raised.exception.message)
        self.assertIn("not allowed", raised.exception.message)

    def test_refuses_init_in_favour_of_its_dedicated_endpoint(self):
        with self.assertRaises(DbtOperationError) as raised:
            validate_dbt_argv(["dbt", "init", "project"])
        self.assertIn("project initialization endpoint", raised.exception.message)

    def test_normal_command_passes_unchanged(self):
        argv = ["dbt", "run", "--select", "x", "--full-refresh"]
        self.assertIs(validate_dbt_argv(argv), argv)
        self.assertEqual(argv, ["dbt", "run", "--select", "x", "--full-refresh"])


class DbtCommandValidationCallPathTest(unittest.IsolatedAsyncioTestCase):
    async def test_command_flags_are_refused_before_project_or_dbt_access(self):
        service = DbtService()
        service.project = MagicMock()
        service._run_dbt_command = AsyncMock()

        with self.assertRaises(DbtOperationError):
            await service.run_command(
                DbtCommand(
                    project_id="project-id",
                    command="run",
                    flags=["--project-dir", "/other/project"],
                )
            )

        service.project.get_path_or_raise.assert_not_called()
        service._run_dbt_command.assert_not_awaited()

    async def test_compile_additional_args_are_refused_before_project_access(self):
        service = DbtService()
        service.project = MagicMock()

        with self.assertRaises(DbtOperationError):
            await service.compile_model(
                CompileRequest(
                    project_id="project-id",
                    model_path="models/orders.sql",
                    additional_args="--state ../other-project/target",
                )
            )

        service.project.get_path_or_raise.assert_not_called()

    async def test_preview_additional_args_are_refused_before_project_access(self):
        service = DbtService()
        service.project = MagicMock()

        with self.assertRaises(DbtOperationError):
            await service.preview_model(
                PreviewRequest(
                    project_id="project-id",
                    model_path="models/orders.sql",
                    additional_args="--target-path=../other-project/target",
                )
            )

        service.project.get_path_or_raise.assert_not_called()

    async def test_explain_additional_args_are_refused_before_project_access(self):
        service = DbtService()
        service.project = MagicMock()

        with self.assertRaises(DbtOperationError):
            await service.explain_model(
                ExplainRequest(
                    project_id="project-id",
                    model_path="models/orders.sql",
                    additional_args="--defer-state ../other-project/target",
                )
            )

        service.project.get_path_or_raise.assert_not_called()

    async def test_query_validates_before_adding_the_server_profiles_path(self):
        service = DbtService()
        service.project = MagicMock()
        service.project.get_path_or_raise.return_value = Path("/server/project")
        service._build_dbt_environment = AsyncMock(return_value={})
        service._run_dbt_command = AsyncMock()

        with patch(
            "app.services.dbt_service.validate_dbt_argv",
            side_effect=DbtOperationError("command validation", "sentinel"),
        ) as validate:
            with self.assertRaises(DbtOperationError):
                await service.query_warehouse(
                    QueryRequest(project_id="project-id", sql="select 1")
                )

        argv = validate.call_args.args[0]
        self.assertEqual(argv[:2], ["dbt", "show"])
        self.assertNotIn("--profiles-dir", argv)
        service._run_dbt_command.assert_not_awaited()

    async def test_streaming_command_is_refused_before_project_sync(self):
        body = DbtCommandRequest(
            command="run --packages-install-path ../other-project/packages"
        )
        with (
            patch("app.routers.sse.resolve_user_id", AsyncMock(return_value="user-id")),
            patch("app.routers.sse._verify_project_ownership", AsyncMock()),
            patch("app.routers.sse.ProjectService") as project_service,
        ):
            with self.assertRaises(DbtOperationError):
                await dbt_sse(
                    "project-id", body, claims={"sub": "subject"}, session=MagicMock()
                )

        project_service.assert_not_called()

    async def test_async_and_scheduled_launches_validate_before_creating_a_run(self):
        request = DbtCommand(
            project_id="project-id",
            command="run",
            flags=["--log-path=/other/project/logs"],
        )
        with patch("app.services.run_launcher.ProjectService") as project_service:
            with self.assertRaises(DbtOperationError):
                await launch_dbt_run(request, "user-id", session=MagicMock())

        project_service.assert_not_called()


if __name__ == "__main__":
    unittest.main()
