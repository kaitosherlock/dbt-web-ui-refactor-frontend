"""Untrusted dbt environment variables cannot alter CLI paths or process code."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.exceptions import DbtOperationError
from app.services.command import CommandService
from app.services.dbt_environment import (
    DBT_CLI_ENV_VARS,
    DBT_PROFILE_SECRET_ENV,
    FALLBACK_DBT_CLI_ENV_VARS,
    sanitize_dbt_environment,
)
from app.services.dbt_service import DbtService
from app.services.dbt_worker_process import _run_dbt
from ingest import lakehouse


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class DbtEnvironmentPolicyTests(unittest.IsolatedAsyncioTestCase):
    def test_cli_envvars_are_discovered_from_installed_dbt(self):
        from dbt.cli import params as dbt_params

        self.assertTrue(set(dbt_params.KNOWN_ENV_VARS) <= DBT_CLI_ENV_VARS)
        self.assertIn("DBT_PACKAGES_INSTALL_PATH", FALLBACK_DBT_CLI_ENV_VARS)

    def test_lake_secret_name_stays_in_the_server_owned_set(self):
        with self.assertRaises(DbtOperationError):
            sanitize_dbt_environment({lakehouse.CATALOG_PASSWORD_ENV: "attacker"})

    def test_every_dbt_cli_envvar_is_rejected_by_name(self):
        for name in DBT_CLI_ENV_VARS:
            with self.subTest(name=name):
                with self.assertRaises(DbtOperationError) as raised:
                    sanitize_dbt_environment({name: "attacker"})
                self.assertIn(name, raised.exception.message)

    async def test_request_rejects_each_protected_name_class(self):
        names = {
            "dbt CLI option": "DBT_PROJECT_DIR",
            "path": "Path",
            "home": "HOME",
            "python": "PYTHONPATH",
            "python startup": "PYTHONSTARTUP",
            "python home": "PYTHONHOME",
            "native loader": "LD_PRELOAD",
            "macOS loader": "DYLD_INSERT_LIBRARIES",
            "virtual environment": "VIRTUAL_ENV",
            "uv": "UV_TOOL_BIN_DIR",
            "profile credential": DBT_PROFILE_SECRET_ENV,
            "target credential": f"{DBT_PROFILE_SECRET_ENV}__PROD",
            "lake credential": "DBT_ENV_SECRET_LAKE_CATALOG_PASSWORD",
        }
        for name_class, name in names.items():
            with self.subTest(name_class=name_class, name=name):
                with self.assertRaises(DbtOperationError) as raised:
                    await DbtService._build_dbt_environment(
                        None, "project-id", None, {name: "attacker"}, {}
                    )
                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn(name, raised.exception.message)

    async def test_persisted_environment_rejects_each_protected_name_class(self):
        names = (
            "DBT_STATE",
            "PATH",
            "HOME",
            "PYTHONPATH",
            "LD_PRELOAD",
            "DYLD_LIBRARY_PATH",
            "VIRTUAL_ENV",
            "UV_PROJECT_ENVIRONMENT",
            DBT_PROFILE_SECRET_ENV,
        )
        for name in names:
            with self.subTest(name=name):
                session = AsyncMock()
                session.execute.return_value = _Rows(
                    [{"name": name, "value_encrypted": "attacker"}]
                )
                with self.assertRaises(DbtOperationError) as raised:
                    await DbtService._load_persisted_environment(
                        session, "project-id", "user-id"
                    )
                self.assertIn(name, raised.exception.message)

    async def test_allowed_request_and_persisted_names_still_pass(self):
        request_env = {
            "ORDINARY_NAME": "ordinary",
            "DBT_ENV_SECRET_REQUEST_TOKEN": "request-secret",
            "DBT_ENV_CUSTOM_ENV_REQUEST_BRANCH": "dev",
        }
        session = AsyncMock()
        session.execute.return_value = _Rows(
            [
                {"name": "PERSISTED_NAME", "value_encrypted": "stored"},
                {
                    "name": "DBT_ENV_SECRET_USER_TOKEN",
                    "value_encrypted": "stored-secret",
                },
                {
                    "name": "DBT_ENV_CUSTOM_ENV_BRANCH",
                    "value_encrypted": "main",
                },
            ]
        )
        with patch(
            "app.services.dbt_service.decrypt_secret_or_plaintext",
            side_effect=lambda value: value,
        ):
            environment = await DbtService._build_dbt_environment(
                session, "project-id", "user-id", request_env, {}
            )

        self.assertEqual(
            environment,
            {
                **request_env,
                "PERSISTED_NAME": "stored",
                "DBT_ENV_SECRET_USER_TOKEN": "stored-secret",
                "DBT_ENV_CUSTOM_ENV_BRANCH": "main",
            },
        )

    async def test_server_profile_values_are_applied_last(self):
        environment = await DbtService._build_dbt_environment(
            None,
            "project-id",
            None,
            {"ORDINARY_NAME": "request"},
            {DBT_PROFILE_SECRET_ENV: "server-secret"},
        )

        self.assertEqual(environment["ORDINARY_NAME"], "request")
        self.assertEqual(environment[DBT_PROFILE_SECRET_ENV], "server-secret")


class DbtProcessEnvironmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_subprocess_inherits_server_env_including_its_dbt_settings(self):
        process = MagicMock()
        process.returncode = 0
        process.communicate = AsyncMock(return_value=(b"", b""))
        inherited = {
            "PATH": "server-path",
            "HOME": "server-home",
            "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
            DBT_PROFILE_SECRET_ENV: "stale-secret",
        }
        with (
            patch.dict(os.environ, inherited, clear=True),
            patch(
                "app.services.command.asyncio.create_subprocess_exec",
                AsyncMock(return_value=process),
            ) as spawn,
        ):
            await CommandService.run(
                ["dbt", "run"],
                Path("."),
                env={
                    "ORDINARY_NAME": "allowed",
                    DBT_PROFILE_SECRET_ENV: "current-secret",
                },
            )

        child_env = spawn.await_args.kwargs["env"]
        self.assertEqual(child_env["PATH"], "server-path")
        self.assertEqual(child_env["HOME"], "server-home")
        # Deployment config, not client input: dropping it re-enables telemetry.
        self.assertEqual(child_env["DBT_SEND_ANONYMOUS_USAGE_STATS"], "false")
        self.assertEqual(child_env["ORDINARY_NAME"], "allowed")
        self.assertEqual(child_env[DBT_PROFILE_SECRET_ENV], "current-secret")

    async def test_warm_worker_uses_the_same_isolated_environment(self):
        captured = {}

        class _Result:
            success = True
            exception = None

        runner = MagicMock()

        def invoke(_args):
            captured.update(os.environ)
            return _Result()

        runner.invoke.side_effect = invoke
        inherited = {
            "PATH": "server-path",
            "DBT_PACKAGES_INSTALL_PATH": "dbt_packages",
            DBT_PROFILE_SECRET_ENV: "stale-secret",
        }
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.dict(os.environ, inherited, clear=True),
            patch("app.services.dbt_worker_process.dbtRunner", return_value=runner),
        ):
            result = _run_dbt(
                ["compile"],
                tmp,
                {
                    "ORDINARY_NAME": "allowed",
                    DBT_PROFILE_SECRET_ENV: "current-secret",
                },
            )

        self.assertEqual(result["returncode"], 0)
        self.assertEqual(captured["PATH"], "server-path")
        self.assertEqual(captured["DBT_PACKAGES_INSTALL_PATH"], "dbt_packages")
        self.assertEqual(captured["ORDINARY_NAME"], "allowed")
        self.assertEqual(captured[DBT_PROFILE_SECRET_ENV], "current-secret")


if __name__ == "__main__":
    unittest.main()
