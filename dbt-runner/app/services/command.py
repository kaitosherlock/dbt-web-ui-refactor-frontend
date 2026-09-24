"""
Command execution service.
Handles running shell commands with support for cancellation.
Uses Redis for cross-worker process tracking.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from app.config import settings
from app.core.redis_client import get_redis
from app.exceptions import DbtOperationError
from app.services.dbt_environment import dbt_process_environment

logger = logging.getLogger(__name__)


def _subprocess_environment(
    cmd: List[str], env: Optional[Dict[str, str]]
) -> Dict[str, str]:
    executable = Path(cmd[0]).name.lower() if cmd else ""
    if executable in {"dbt", "dbt.exe"}:
        return dbt_process_environment(env)
    return {**os.environ, **(env or {})}


ALLOWED_DBT_SUBCOMMANDS = frozenset(
    {
        "run",
        "test",
        "build",
        "seed",
        "snapshot",
        "compile",
        "show",
        "docs",
        "deps",
        "clean",
        "source",
        "parse",
        "ls",
        "list",
        "debug",
        "run-operation",
        "retry",
        "clone",
    }
)

DBT_PATH_FLAGS = frozenset(
    {
        "--project-dir",
        "--profiles-dir",
        "--target-path",
        "--log-path",
        "--state",
        "--packages-install-path",
        "--defer-state",
    }
)

DBT_SERVER_STATE_FLAGS = frozenset({"--defer", "--favor-state"})


def validate_dbt_argv(argv: List[str]) -> List[str]:
    """Validate client-built argv before server-owned path flags are appended."""
    if len(argv) < 2 or argv[0] != "dbt":
        raise DbtOperationError(
            "command validation", "expected argv to start with a dbt subcommand"
        )

    subcommand = argv[1]
    if subcommand not in ALLOWED_DBT_SUBCOMMANDS:
        if subcommand == "init":
            message = (
                "dbt subcommand 'init' is not allowed here; "
                "use the project initialization endpoint"
            )
        else:
            message = f"dbt subcommand '{subcommand}' is not allowed"
        raise DbtOperationError("command validation", message)

    for token in argv[2:]:
        for flag in DBT_PATH_FLAGS:
            if token == flag or token.startswith(f"{flag}="):
                raise DbtOperationError(
                    "command validation",
                    f"client-provided filesystem path flag '{flag}' is not allowed; "
                    "dbt paths are managed by the server",
                )
        for flag in DBT_SERVER_STATE_FLAGS:
            if token == flag or token.startswith(f"{flag}="):
                raise DbtOperationError(
                    "command validation",
                    f"client-provided state flag '{flag}' is not allowed; "
                    "use the server-managed state options",
                )

    return argv


def append_server_state_flags(
    argv: List[str],
    state_dir: Optional[Path],
    *,
    defer: bool = False,
    favor_state: bool = False,
) -> List[str]:
    """Validate client argv, then append server-derived state flags."""
    validate_dbt_argv(argv)
    if state_dir is not None:
        argv.extend(["--state", str(state_dir)])
    if defer:
        argv.append("--defer")
    if favor_state:
        argv.append("--favor-state")
    return argv


# ---- Structured run options -------------------------------------------------
#
# The UI sends these as fields, never as argv text, and the server serialises
# each one. Which subcommand accepts which flag follows dbt's own click
# definitions (tests/test_dbt_run_options.py compares the tables against them),
# so a field the command cannot take is refused here with a message instead of
# by dbt's usage error.

MAX_VARS_BYTES = 16 * 1024
MAX_ARGS_BYTES = 16 * 1024

VARS_COMMANDS = ALLOWED_DBT_SUBCOMMANDS
EMPTY_COMMANDS = frozenset({"run", "build", "compile", "snapshot"})
SAMPLE_COMMANDS = frozenset({"run", "build"})
EVENT_TIME_COMMANDS = frozenset({"run", "build"})
FULL_REFRESH_COMMANDS = frozenset(
    {"run", "build", "clone", "compile", "retry", "seed", "show"}
)
SELECTOR_COMMANDS = frozenset(
    {
        "run",
        "build",
        "test",
        "seed",
        "snapshot",
        "compile",
        "show",
        "ls",
        "list",
        "clone",
        "docs generate",
        "source freshness",
        "source snapshot-freshness",
    }
)

# dbt's SampleWindow.from_relative_string: "<int> <grain>" split on one space,
# the grain one of dbt's BatchSize values with an optional plural "s".
_SAMPLE_RE = re.compile(
    r"^\s*([1-9][0-9]{0,5})\s+(hour|day|month|year)s?\s*$", re.IGNORECASE
)
SELECTOR_NAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
# click.DateTime's default format, which is what dbt parses --event-time-* with.
_EVENT_TIME_FORMAT = "%Y-%m-%dT%H:%M:%S"


def _refuse(message: str) -> None:
    raise DbtOperationError("command validation", message)


def dbt_command_key(argv: List[str]) -> str:
    """The subcommand as the option tables name it: `docs generate`, not `docs`."""
    if len(argv) < 2:
        return ""
    if argv[1] in {"docs", "source"} and len(argv) > 2 and not argv[2].startswith("-"):
        return f"{argv[1]} {argv[2]}"
    return argv[1]


def _has_flag(argv: List[str], flag: str) -> bool:
    return any(token == flag or token.startswith(f"{flag}=") for token in argv[2:])


def serialize_json_arg(value: Any, *, name: str, limit: int) -> str:
    """One JSON argv value for --vars / --args, refused when unsafe or too big.

    JSON is valid YAML, which is what dbt parses these flags as, and no shell
    sits between argv and dbt, so the string needs no quoting.
    """
    if not isinstance(value, dict):
        _refuse(f"{name} must be an object of name: value pairs")
    try:
        encoded = json.dumps(value, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        _refuse(f"{name} must be JSON-serialisable: {exc}")
    if len(encoded.encode()) > limit:
        _refuse(f"{name} is larger than {limit // 1024} KiB")
    return encoded


def _event_time(value: Any, name: str) -> datetime:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            _refuse(f"{name} must be an ISO 8601 datetime")
    if not isinstance(value, datetime):
        _refuse(f"{name} must be an ISO 8601 datetime")
    if value.tzinfo is not None:
        # dbt's flag carries no zone and treats the value as UTC.
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def project_selector_names(project_path: Path) -> Optional[List[str]]:
    """Names defined in the project's selectors.yml, or None without one."""
    path = project_path / "selectors.yml"
    if not path.is_file():
        return None
    try:
        document = yaml.safe_load(path.read_text()) or {}
    except (OSError, yaml.YAMLError) as exc:
        _refuse(f"selectors.yml cannot be read: {exc}")
    selectors = document.get("selectors") if isinstance(document, dict) else None
    return [
        str(item["name"])
        for item in selectors or []
        if isinstance(item, dict) and item.get("name")
    ]


def append_run_options(
    argv: List[str], options: Any, *, project_path: Optional[Path] = None
) -> List[str]:
    """Append a request's structured options to already-validated argv.

    `options` is any request model; a field it does not declare counts as
    unset, so compile and preview requests (vars only) share this path.
    Without `project_path` a selector name is shape-checked only.
    """
    command = dbt_command_key(argv)
    top = argv[1] if len(argv) > 1 else ""

    def option(name: str) -> Any:
        return getattr(options, name, None)

    def conflict(flag: str) -> None:
        if _has_flag(argv, flag):
            _refuse(f"'{flag}' was given both as a field and in the command; send it once")

    def supported(field: str, commands: frozenset, value: Any) -> bool:
        if not value:
            return False
        if command not in commands and top not in commands:
            _refuse(f"'{field}' is not supported by dbt {command}")
        return True

    variables = option("vars")
    if variables is not None:
        conflict("--vars")
        if supported("vars", VARS_COMMANDS, variables):
            argv.extend(
                ["--vars", serialize_json_arg(variables, name="vars", limit=MAX_VARS_BYTES)]
            )

    if supported("empty", EMPTY_COMMANDS, option("empty")):
        conflict("--empty")
        argv.append("--empty")

    sample = option("sample")
    if supported("sample", SAMPLE_COMMANDS, sample):
        conflict("--sample")
        match = _SAMPLE_RE.fullmatch(str(sample))
        if not match:
            _refuse(
                "sample must look like '<count> <grain>', grain one of "
                "hour, day, month, year (e.g. '3 days')"
            )
        argv.extend(["--sample", f"{int(match.group(1))} {match.group(2).lower()}"])

    start, end = option("event_time_start"), option("event_time_end")
    if supported("event_time_start/event_time_end", EVENT_TIME_COMMANDS, start or end):
        if not (start and end):
            _refuse("event_time_start and event_time_end must be given together")
        conflict("--event-time-start")
        conflict("--event-time-end")
        start_at = _event_time(start, "event_time_start")
        end_at = _event_time(end, "event_time_end")
        if start_at >= end_at:
            _refuse("event_time_start must be before event_time_end")
        argv.extend(
            [
                "--event-time-start",
                start_at.strftime(_EVENT_TIME_FORMAT),
                "--event-time-end",
                end_at.strftime(_EVENT_TIME_FORMAT),
            ]
        )

    if supported("full_refresh", FULL_REFRESH_COMMANDS, option("full_refresh")):
        # Older clients put --full-refresh in `flags`; saying it twice is harmless.
        if not _has_flag(argv, "--full-refresh"):
            argv.append("--full-refresh")

    selector_name = option("selector_name")
    if supported("selector_name", SELECTOR_COMMANDS, selector_name):
        if _has_flag(argv, "--select") or _has_flag(argv, "-s"):
            _refuse(
                "selector_name cannot be combined with selector/--select; choose one"
            )
        conflict("--selector")
        if not SELECTOR_NAME_RE.fullmatch(str(selector_name)):
            _refuse(f"invalid selector name '{selector_name}'")
        if project_path is not None:
            names = project_selector_names(project_path)
            if names is None:
                _refuse("the project has no selectors.yml, so no selector can be named")
            if selector_name not in names:
                _refuse(f"selectors.yml defines no selector named '{selector_name}'")
        argv.extend(["--selector", selector_name])

    return argv


class CommandService:
    """
    Service for executing shell commands.

    Uses Redis for process tracking to enable cross-worker cancellation.
    Local process references are kept in instance variable for actual termination.
    """

    # Redis key prefix for process tracking
    PROCESS_KEY_PREFIX = "running_process"

    # Local process references (per-worker, for actual termination)
    _local_processes: Dict[str, asyncio.subprocess.Process] = {}

    @classmethod
    async def _register_process(cls, process_id: str) -> None:
        """Register running process in Redis with worker ID."""
        try:
            redis = await get_redis()
            if redis:
                worker_id = f"{os.getpid()}"
                await redis.set(
                    f"{cls.PROCESS_KEY_PREFIX}:{process_id}",
                    worker_id,
                    ex=300,  # 5 min TTL as safety net
                )
        except Exception as e:
            logger.warning(f"Failed to register process in Redis: {e}")

    @classmethod
    async def _unregister_process(cls, process_id: str) -> None:
        """Unregister process from Redis."""
        try:
            redis = await get_redis()
            if redis:
                await redis.delete(f"{cls.PROCESS_KEY_PREFIX}:{process_id}")
        except Exception as e:
            logger.warning(f"Failed to unregister process from Redis: {e}")

    @classmethod
    async def _mark_cancelled(cls, process_id: str) -> None:
        """Mark process as cancelled in Redis (for cross-worker signaling)."""
        try:
            redis = await get_redis()
            if redis:
                await redis.set(
                    f"{cls.PROCESS_KEY_PREFIX}:{process_id}:cancelled",
                    "1",
                    ex=60,  # Short TTL for cancel signal
                )
        except Exception as e:
            logger.warning(f"Failed to mark process cancelled: {e}")

    @classmethod
    async def _is_cancelled(cls, process_id: str) -> bool:
        """Check if process was marked as cancelled."""
        try:
            redis = await get_redis()
            if redis:
                return (
                    await redis.exists(
                        f"{cls.PROCESS_KEY_PREFIX}:{process_id}:cancelled"
                    )
                    > 0
                )
        except Exception:
            pass
        return False

    @classmethod
    async def run(
        cls, cmd: List[str], cwd: Path, env: Optional[Dict[str, str]] = None
    ) -> Tuple[int, str, str]:
        """
        Run a shell command and return result.

        Args:
            cmd: Command as list of strings
            cwd: Working directory

        Returns:
            Tuple of (returncode, stdout, stderr)
        """
        logger.debug(f"Running command: {' '.join(cmd)} in {cwd}")

        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            env=_subprocess_environment(cmd, env),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        return process.returncode or 0, stdout.decode(), stderr.decode()

    @classmethod
    async def run_cancellable(
        cls,
        cmd: List[str],
        cwd: Path,
        process_id: str,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Tuple[int, str, str]:
        """
        Run a shell command that can be cancelled.

        Args:
            cmd: Command as list of strings
            cwd: Working directory
            process_id: Unique identifier for the process (usually project_id)

        Returns:
            Tuple of (returncode, stdout, stderr)
        """
        logger.debug(
            f"Running cancellable command: {' '.join(cmd)} with id {process_id}"
        )

        # Never wait forever: a hung dbt holds the project lock until TTL.
        if timeout is None:
            timeout = settings.dbt_subprocess_timeout

        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            env=_subprocess_environment(cmd, env),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Store in both local dict and Redis
        cls._local_processes[process_id] = process
        await cls._register_process(process_id)

        try:
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                process.terminate()
                try:
                    stdout, stderr = await asyncio.wait_for(
                        process.communicate(),
                        timeout=5,
                    )
                except asyncio.TimeoutError:
                    process.kill()
                    stdout, stderr = await process.communicate()
                return (
                    -1,
                    stdout.decode(),
                    stderr.decode()
                    or f"Command timed out after {timeout:g} seconds",
                )

            # Check if cancelled by another worker
            if await cls._is_cancelled(process_id):
                return -1, "", "Command cancelled by user"

            return process.returncode or 0, stdout.decode(), stderr.decode()
        except asyncio.CancelledError:
            process.terminate()
            await process.wait()
            return -1, "", "Command cancelled by user"
        finally:
            # Remove from tracking
            cls._local_processes.pop(process_id, None)
            await cls._unregister_process(process_id)

    @classmethod
    async def cancel(cls, process_id: str) -> bool:
        """
        Cancel a running process.

        Works across workers by:
        1. Marking cancelled in Redis (for cross-worker notification)
        2. Terminating local process if running on this worker

        Args:
            process_id: Process identifier

        Returns:
            True if cancellation was signaled
        """
        # Always mark as cancelled in Redis (works across workers)
        await cls._mark_cancelled(process_id)

        # Try to terminate local process if it exists on this worker
        process = cls._local_processes.get(process_id)
        if process:
            try:
                process.terminate()
                await asyncio.sleep(0.5)
                if process.returncode is None:
                    process.kill()
                cls._local_processes.pop(process_id, None)
                logger.info(f"Process {process_id} terminated locally")
            except Exception as e:
                logger.error(f"Error terminating process {process_id}: {e}")

        # Unregister from Redis
        await cls._unregister_process(process_id)
        logger.info(f"Process {process_id} cancelled")
        return True

    @classmethod
    async def is_running(cls, process_id: str) -> bool:
        """
        Check if a process is running (in any worker).

        Args:
            process_id: Process identifier

        Returns:
            True if process is running
        """
        try:
            redis = await get_redis()
            if redis:
                return await redis.exists(f"{cls.PROCESS_KEY_PREFIX}:{process_id}") > 0
        except Exception:
            pass
        # Fallback to local check
        process = cls._local_processes.get(process_id)
        return process is not None and process.returncode is None
