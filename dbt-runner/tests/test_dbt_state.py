"""State artifacts, server-owned flags, and retry/clone launch paths."""

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.exceptions import DbtOperationError
from app.models.dbt import DbtCloneRequest, DbtCommand, DbtRetryRequest
from app.routers.dbt import clone_dbt_state, delete_dbt_target_state, retry_dbt_run
from app.routers.project import ProjectDeleteRequest, delete_project
from app.services.command import validate_dbt_argv
from app.services.dbt_service import DbtService
from app.services.run_launcher import launch_dbt_run
from app.services.scheduler import RunScheduler
from app.services.state import StateService, effective_target

PROJECT_ID = "00000000-0000-4000-8000-00000000000a"


class _AsyncContext:
    def __init__(self, value=None):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _ProjectService:
    def __init__(self, path: Path):
        self.path = path

    def get_path_or_raise(self, _project_id: str) -> Path:
        return self.path


def _write_artifacts(project: Path, invocation_id: str = "inv-1", **args) -> None:
    target = project / "target"
    target.mkdir(parents=True, exist_ok=True)
    (target / "manifest.json").write_text('{"nodes": {}}')
    (target / "run_results.json").write_text(
        json.dumps(
            {
                "metadata": {"invocation_id": invocation_id},
                "args": {"which": "build", **args},
                "results": [],
            }
        )
    )


class StateStorageTest(unittest.TestCase):
    def test_save_copies_artifacts_and_cleanup_removes_target_and_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "workspace"
            target = project / "target"
            target.mkdir(parents=True)
            (target / "manifest.json").write_text('{"generation": 1}')
            (target / "run_results.json").write_text('{"results": []}')
            state = StateService(root / "storage")

            self.assertTrue(state.save(PROJECT_ID, "prod", project))
            saved = state.target_dir(PROJECT_ID, "prod")
            self.assertEqual(saved, root / "storage" / "state" / PROJECT_ID / "prod")
            self.assertEqual((saved / "manifest.json").read_text(), '{"generation": 1}')
            self.assertEqual((saved / "run_results.json").read_text(), '{"results": []}')
            self.assertEqual(state.list_targets(PROJECT_ID)[0]["target"], "prod")
            # No temporary files are left beside the published artifacts.
            self.assertEqual(
                sorted(p.name for p in saved.iterdir()),
                ["manifest.json", "run_results.json"],
            )

            self.assertTrue(state.delete_target(PROJECT_ID, "prod"))
            self.assertFalse(saved.exists())
            self.assertFalse(state.delete_target(PROJECT_ID, "prod"))

            (target / "manifest.json").write_text('{"generation": 2}')
            state.save(PROJECT_ID, "prod", project)
            state.save(PROJECT_ID, "staging", project)
            self.assertTrue(state.delete_project(PROJECT_ID))
            self.assertFalse(saved.parent.exists())
            self.assertFalse(state.delete_project(PROJECT_ID))

    def test_missing_manifest_does_not_publish_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "workspace"
            (project / "target").mkdir(parents=True)
            state = StateService(root / "storage")

            self.assertFalse(state.save(PROJECT_ID, "prod", project))
            self.assertEqual(state.list_targets(PROJECT_ID), [])

    def test_project_and_target_cannot_escape_state_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = StateService(Path(tmp))
            cases = (
                ("../other", "prod"),
                ("project-1", "prod"),
                ("", "prod"),
                (f"{PROJECT_ID}/..", "prod"),
                (PROJECT_ID, "../prod"),
                (PROJECT_ID, "Prod"),
                (PROJECT_ID, "prod/x"),
                (PROJECT_ID, ""),
            )
            for project_id, target in cases:
                with self.subTest(project_id=project_id, target=target):
                    with self.assertRaises(DbtOperationError):
                        state.target_dir(project_id, target)
            with self.assertRaises(DbtOperationError):
                state.delete_project("../../etc")

    def test_effective_target_reads_the_last_target_flag(self):
        self.assertEqual(effective_target(["dbt", "build"]), "dev")
        self.assertEqual(effective_target(["dbt", "build", "--target", "prod"]), "prod")
        self.assertEqual(effective_target(["dbt", "build", "-t", "ci"]), "ci")
        self.assertEqual(effective_target(["dbt", "build", "--target=stg"]), "stg")
        self.assertEqual(
            effective_target(["dbt", "build", "--target", "a", "--target", "b"]), "b"
        )


class StateCommandTest(unittest.IsolatedAsyncioTestCase):
    async def _run(
        self,
        returncode: int,
        request: DbtCommand,
        *,
        persist_state=False,
        writes_artifacts=True,
    ):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        project = Path(temporary.name)
        state = MagicMock(spec=StateService)
        state.save.return_value = True
        state.require_state.return_value = project / "state" / "prod"
        service = DbtService(project_service=_ProjectService(project), state_service=state)

        async def run_dbt(*_args, **_kwargs):
            if writes_artifacts:
                _write_artifacts(project)
            return returncode, "output", "error" if returncode else ""

        run_dbt = AsyncMock(side_effect=run_dbt)
        with (
            patch(
                "app.services.dbt_service.global_run_semaphore",
                return_value=_AsyncContext(),
            ),
            patch(
                "app.services.dbt_service.AsyncFileLock.lock",
                return_value=_AsyncContext(),
            ),
            patch.object(service, "_run_dbt_command", run_dbt),
        ):
            result = await service.run_command(request, persist_state=persist_state)
        return result, run_dbt, state, project

    async def test_server_appends_state_defer_and_favor_state(self):
        request = DbtCommand(
            project_id=PROJECT_ID,
            command="build",
            target="dev",
            state_target="prod",
            defer=True,
            favor_state=True,
        )
        result, run_dbt, state, _project = await self._run(0, request)

        self.assertTrue(result["success"])
        state.require_state.assert_called_once_with(PROJECT_ID, "prod")
        argv = run_dbt.await_args.args[0]
        self.assertEqual(argv[argv.index("--state") + 1], str(state.require_state.return_value))
        self.assertIn("--defer", argv)
        self.assertIn("--favor-state", argv)
        # A dev run that only *reads* prod state does not publish any state.
        state.save.assert_not_called()

    async def test_state_target_alone_enables_state_selection_without_defer(self):
        request = DbtCommand(
            project_id=PROJECT_ID,
            command="build",
            selector="state:modified+",
            state_target="prod",
        )
        _result, run_dbt, _state, _project = await self._run(0, request)
        argv = run_dbt.await_args.args[0]
        self.assertIn("--state", argv)
        self.assertNotIn("--defer", argv)

    async def test_successful_non_dev_run_saves_state_but_failure_does_not(self):
        success = DbtCommand(project_id=PROJECT_ID, command="build", target="prod")
        _result, _run, successful_state, project = await self._run(0, success)
        successful_state.save.assert_called_once_with(PROJECT_ID, "prod", project)

        _result, _run, failed_state, _project = await self._run(1, success)
        failed_state.save.assert_not_called()

    async def test_target_inside_the_command_string_names_the_state(self):
        request = DbtCommand(project_id=PROJECT_ID, command="run --target prod")
        _result, _run, state, project = await self._run(0, request)
        state.save.assert_called_once_with(PROJECT_ID, "prod", project)

    async def test_plain_dev_run_does_not_save_state(self):
        request = DbtCommand(project_id=PROJECT_ID, command="build")
        _result, _run, state, _project = await self._run(0, request)
        state.save.assert_not_called()

    async def test_commands_that_deploy_nothing_do_not_save_state(self):
        for command in ("compile", "ls", "test", "show", "clone"):
            with self.subTest(command=command):
                request = DbtCommand(
                    project_id=PROJECT_ID,
                    command=command,
                    target="prod",
                    state_target="prod" if command == "clone" else None,
                )
                _result, _run, state, _project = await self._run(
                    0, request, persist_state=True
                )
                state.save.assert_not_called()

    async def test_stale_artifacts_from_an_earlier_run_are_not_saved(self):
        request = DbtCommand(project_id=PROJECT_ID, command="build", target="prod")
        _result, _run, state, _project = await self._run(
            0, request, writes_artifacts=False
        )
        state.save.assert_not_called()

    async def test_scheduled_dev_run_can_request_state_persistence(self):
        request = DbtCommand(project_id=PROJECT_ID, command="build")
        _result, _run, state, project = await self._run(0, request, persist_state=True)
        state.save.assert_called_once_with(PROJECT_ID, "dev", project)

    async def test_retry_with_a_private_state_dir_appends_state_without_reading_target(self):
        """A retry started with its own server-owned state dir (set by the
        retry endpoint via the private `_retry_state_dir` attribute) must
        append `--state DIR` and must not require target/run_results.json to
        exist at all - the whole point is not depending on that file.
        """
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "workspace"
            project.mkdir(parents=True)
            retry_dir = Path(tmp) / "retry-state"
            retry_dir.mkdir(parents=True)
            (retry_dir / "run_results.json").write_text(
                json.dumps({"args": {"which": "build"}, "results": []})
            )

            request = DbtCommand(project_id=PROJECT_ID, command="retry")
            request._retry_state_dir = retry_dir

            service = DbtService(
                project_service=_ProjectService(project),
                state_service=StateService(Path(tmp) / "storage"),
            )

            async def run_dbt(*_args, **_kwargs):
                return 0, "output", ""

            with (
                patch(
                    "app.services.dbt_service.global_run_semaphore",
                    return_value=_AsyncContext(),
                ),
                patch(
                    "app.services.dbt_service.AsyncFileLock.lock",
                    return_value=_AsyncContext(),
                ),
                patch.object(
                    service, "_run_dbt_command", AsyncMock(side_effect=run_dbt)
                ) as run_dbt_mock,
            ):
                result = await service.run_command(request)

        self.assertTrue(result["success"])
        argv = run_dbt_mock.await_args.args[0]
        self.assertEqual(argv[argv.index("--state") + 1], str(retry_dir))

    async def test_retry_and_clone_refuse_missing_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = DbtService(
                project_service=_ProjectService(Path(tmp)),
                state_service=StateService(Path(tmp) / "storage"),
            )
            with self.assertRaisesRegex(DbtOperationError, "run_results.json"):
                await service.run_command(DbtCommand(project_id=PROJECT_ID, command="retry"))
            with self.assertRaisesRegex(DbtOperationError, "no saved dbt state"):
                await service.run_command(
                    DbtCommand(project_id=PROJECT_ID, command="clone", state_target="prod")
                )
            with self.assertRaisesRegex(DbtOperationError, "state_target is required"):
                await service.run_command(DbtCommand(project_id=PROJECT_ID, command="clone"))

    async def test_invalid_state_option_combinations_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_artifacts(Path(tmp))
            service = DbtService(
                project_service=_ProjectService(Path(tmp)),
                state_service=StateService(Path(tmp) / "storage"),
            )
            cases = (
                (dict(command="build", defer=True), "state_target is required"),
                (dict(command="build", state_target="prod", favor_state=True), "favor_state"),
                (dict(command="build", state_target="../prod"), "invalid target name"),
                (dict(command="retry", state_target="prod"), "retry"),
            )
            for fields, message in cases:
                with self.subTest(fields=fields):
                    with self.assertRaisesRegex(DbtOperationError, message):
                        await service.run_command(DbtCommand(project_id=PROJECT_ID, **fields))

    def test_client_cannot_send_state_flags_or_paths(self):
        for flags in (
            ["--defer"],
            ["--favor-state"],
            ["--state", "/tmp/x"],
            ["--state=/tmp/x"],
            ["--defer-state", "/tmp/x"],
        ):
            with self.subTest(flags=flags):
                with self.assertRaises(DbtOperationError):
                    validate_dbt_argv(["dbt", "build", *flags])


class LauncherStateTest(unittest.IsolatedAsyncioTestCase):
    async def test_missing_state_is_refused_before_a_history_row_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            project_service = MagicMock()
            project_service.get_or_sync = AsyncMock(return_value=Path(tmp))
            insert = AsyncMock()
            with (
                patch("app.services.run_launcher.ProjectService", return_value=project_service),
                patch(
                    "app.services.run_launcher.StateService",
                    return_value=StateService(Path(tmp) / "storage"),
                ),
                patch("app.services.run_launcher.DbtService._insert_run_start", insert),
            ):
                with self.assertRaisesRegex(DbtOperationError, "no saved dbt state"):
                    await launch_dbt_run(
                        DbtCommand(project_id=PROJECT_ID, command="clone", state_target="prod"),
                        "user-1",
                        session=MagicMock(),
                    )
                with self.assertRaisesRegex(DbtOperationError, "run_results.json"):
                    await launch_dbt_run(
                        DbtCommand(project_id=PROJECT_ID, command="retry"),
                        "user-1",
                        session=MagicMock(),
                    )
            insert.assert_not_awaited()


class SchedulerStateTest(unittest.IsolatedAsyncioTestCase):
    async def test_schedule_launches_with_state_persistence(self):
        now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        schedule = {
            "id": "00000000-0000-4000-8000-000000000001",
            "project_id": "00000000-0000-4000-8000-000000000002",
            "created_by": "00000000-0000-4000-8000-000000000003",
            "name": "nightly",
            "cron": "*/5 * * * *",
            "next_run_at": now,
            "command": "build",
            "selector": None,
            "target": None,
            "webhook_url": None,
            "publish_schema": None,
        }
        session = MagicMock()
        session.execute = AsyncMock()
        session.commit = AsyncMock()
        launch = AsyncMock(return_value={"run_id": "run-1"})
        with (
            patch("app.services.scheduler.async_session", return_value=_AsyncContext(session)),
            patch("app.services.scheduler.launch_dbt_run", launch),
        ):
            self.assertTrue(await RunScheduler()._handle_due_schedule(schedule, now))

        self.assertTrue(launch.await_args.kwargs["persist_state"])


class StateEndpointTest(unittest.IsolatedAsyncioTestCase):
    async def _retry(self, run_row, state: StateService):
        launch = AsyncMock(return_value={"status": "running"})
        with (
            patch("app.routers.dbt.resolve_user_id", AsyncMock(return_value="user-1")),
            patch("app.routers.dbt._load_owned_dbt_run", AsyncMock(return_value=run_row)),
            patch("app.routers.dbt.StateService", return_value=state),
            patch("app.routers.dbt.launch_dbt_run", launch),
        ):
            await retry_dbt_run("run-1", DbtRetryRequest(), {}, MagicMock())
        return launch

    async def test_retry_uses_stored_results_even_after_a_show_replaced_target(self):
        """The failed run's own results live on its dbt_runs row. A `dbt
        show`/compile/preview on the same project takes no run lock and can
        freely replace target/run_results.json in between - retry must not
        care, because it never reads that file at all.
        """
        with tempfile.TemporaryDirectory() as tmp:
            state = StateService(Path(tmp) / "storage")
            stored = {
                "metadata": {"invocation_id": "inv-1"},
                "args": {"which": "build", "target": "prod"},
                "results": [],
            }
            row = {
                "project_id": PROJECT_ID,
                "status": "error",
                "results": json.dumps(stored),
            }
            launch = await self._retry(row, state)

            command = launch.await_args.args[0]
            retry_run_id = launch.await_args.kwargs["run_id"]
            self.assertEqual(command.command, "retry")
            self.assertEqual(command.target, "prod")
            self.assertIsNone(command.state_target)

            # The server wrote the failed run's own stored results into a
            # private directory keyed by this retry attempt's own run id
            # (handed to launch_dbt_run as `run_id`), and pointed the command
            # at it via the private, request-body-proof attribute - not by
            # reading anything from the project's target/ directory.
            retry_dir = state.retry_dir(PROJECT_ID, retry_run_id)
            self.assertEqual(command._retry_state_dir, retry_dir)
            self.assertEqual(
                json.loads((retry_dir / "run_results.json").read_text()), stored
            )

            # A second retry of the same failed run gets its own directory,
            # so one attempt's later cleanup cannot break the other's.
            launch2 = await self._retry(row, state)
            retry_run_id_2 = launch2.await_args.kwargs["run_id"]
            self.assertNotEqual(retry_run_id, retry_run_id_2)

    async def test_retry_refuses_when_not_failed_missing_or_not_retryable(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = StateService(Path(tmp) / "storage")
            cases = (
                # Not the most recent status: only a failed run can be retried.
                {"status": "success", "results": json.dumps({"args": {"which": "build"}})},
                # No stored results at all - nothing to retry.
                {"status": "error", "results": None},
                # Stored results name a command dbt retry cannot replay.
                {"status": "error", "results": json.dumps({"args": {"which": "show"}})},
            )
            for row in cases:
                with self.subTest(row=row):
                    with self.assertRaises(HTTPException) as caught:
                        await self._retry({"project_id": PROJECT_ID, **row}, state)
                    self.assertEqual(caught.exception.status_code, 409)

    async def test_clone_endpoint_uses_run_launcher_with_server_state(self):
        launch = AsyncMock(return_value={"status": "running"})
        with (
            patch("app.routers.dbt.resolve_user_id", AsyncMock(return_value="user-1")),
            patch("app.routers.dbt._verify_project_ownership", AsyncMock()),
            patch("app.routers.dbt.launch_dbt_run", launch),
        ):
            await clone_dbt_state(
                DbtCloneRequest(project_id=PROJECT_ID, state_target="prod", target="dev"),
                {},
                MagicMock(),
            )

        command = launch.await_args.args[0]
        self.assertEqual(command.command, "clone")
        self.assertEqual(command.state_target, "prod")
        self.assertIsNone(command.flags)

    async def test_target_state_delete_endpoint_removes_the_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "workspace"
            _write_artifacts(project)
            state = StateService(Path(tmp) / "storage")
            state.save(PROJECT_ID, "prod", project)
            with (
                patch("app.routers.dbt.resolve_user_id", AsyncMock(return_value="user-1")),
                patch("app.routers.dbt._verify_project_ownership", AsyncMock()),
                patch("app.routers.dbt.StateService", return_value=state),
            ):
                result = await delete_dbt_target_state(PROJECT_ID, "prod", {}, MagicMock())
                self.assertTrue(result["deleted"])
                self.assertFalse(state.target_dir(PROJECT_ID, "prod").exists())
                with self.assertRaises(DbtOperationError):
                    await delete_dbt_target_state(PROJECT_ID, "..", {}, MagicMock())

    async def test_project_deletion_cleans_state(self):
        for hard_delete in (True, False):
            with self.subTest(hard_delete=hard_delete):
                project = MagicMock()
                project.get_path.return_value = Path("missing-project")
                storage = MagicMock()
                storage.delete_from_storage = AsyncMock(return_value=True)
                storage.mark_deleted = AsyncMock(return_value=True)
                state = MagicMock()
                state.delete_project.return_value = True
                with (
                    patch("app.routers.project._require_owner", AsyncMock()),
                    patch("app.routers.project.ProjectService", return_value=project),
                    patch("app.routers.project.get_storage_service", return_value=storage),
                    patch("app.routers.project.StateService", return_value=state),
                ):
                    result = await delete_project(
                        ProjectDeleteRequest(project_id=PROJECT_ID, hard_delete=hard_delete),
                        {},
                        MagicMock(),
                    )

                state.delete_project.assert_called_once_with(PROJECT_ID)
                self.assertTrue(result["state_cleaned"])

    async def test_state_cleanup_failure_does_not_block_project_deletion(self):
        project = MagicMock()
        project.get_path.return_value = Path("missing-project")
        storage = MagicMock()
        storage.delete_from_storage = AsyncMock(return_value=True)
        with (
            patch("app.routers.project._require_owner", AsyncMock()),
            patch("app.routers.project.ProjectService", return_value=project),
            patch("app.routers.project.get_storage_service", return_value=storage),
        ):
            result = await delete_project(
                ProjectDeleteRequest(project_id="not-a-uuid", hard_delete=True),
                {},
                MagicMock(),
            )
        self.assertTrue(result["success"])
        self.assertFalse(result["state_cleaned"])


if __name__ == "__main__":
    unittest.main()
