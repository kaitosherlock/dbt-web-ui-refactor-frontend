"""Server-owned dbt state artifacts.

Clients select a named target, never a filesystem path.  The path below is
therefore derived entirely from validated project and target identifiers.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings
from app.exceptions import DbtOperationError

logger = logging.getLogger(__name__)

STATE_ARTIFACTS = ("manifest.json", "run_results.json")
DEFAULT_STATE_TARGET = "dev"
# Target names become profiles.yml output keys, dbt --target values, env var
# suffixes and state directory names, so the shape is checked once here rather
# than escaped four times.
TARGET_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,29}$")

# Commands whose success means the target now holds what the manifest
# describes. compile/ls/show/test/docs also write a manifest, but nothing was
# deployed, so saving it would make state:modified hide undeployed changes.
# clone is excluded too: it points relations at *another* target's state.
STATE_PRODUCING_COMMANDS = frozenset({"run", "build", "seed", "snapshot", "retry"})

# `dbt retry` replays these commands only (dbt/task/retry.py TASK_DICT).
RETRYABLE_COMMANDS = frozenset(
    {"build", "compile", "clone", "generate", "seed", "snapshot", "test", "run", "run-operation"}
)


def _validate_project_id(project_id: str) -> str:
    try:
        return str(uuid.UUID(str(project_id or "").strip()))
    except (ValueError, AttributeError, TypeError):
        raise DbtOperationError("state", "invalid project identifier") from None


def _validate_run_id(run_id: str) -> str:
    try:
        return str(uuid.UUID(str(run_id or "").strip()))
    except (ValueError, AttributeError, TypeError):
        raise DbtOperationError("state", "invalid run identifier") from None


def validate_target_name(target: str) -> str:
    if not TARGET_NAME_RE.fullmatch(target or ""):
        raise DbtOperationError(
            "state",
            f"invalid target name '{target}' - lowercase letters, digits and underscores only",
        )
    return target


def effective_target(argv: List[str]) -> str:
    """The target dbt will actually use: the last --target/-t in argv, else dev.

    `command` may be a full string ("build --target prod"), so the request's
    `target` field alone does not say where a run went.
    """
    target: Optional[str] = None
    for index, token in enumerate(argv):
        if token in ("--target", "-t") and index + 1 < len(argv):
            target = argv[index + 1]
        elif token.startswith("--target="):
            target = token.split("=", 1)[1]
    return target or DEFAULT_STATE_TARGET


def _file_mtime_ns(path: Path) -> Optional[int]:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


async def save_state_after_run(
    state: "StateService",
    *,
    project_id: str,
    argv: List[str],
    project_path: Path,
    returncode: int,
    run_results_mtime_before: Optional[int],
    persist_default_target: bool = False,
) -> bool:
    """Save fresh state produced by one successful dbt invocation.

    Callers must invoke this while holding the project's run lock.  Taking the
    pre-run mtime under that same lock ensures another invocation cannot be
    mistaken for the producer of ``run_results.json``.
    """
    command_name = argv[1] if len(argv) > 1 else ""
    target = effective_target(argv)
    if (
        returncode != 0
        or command_name not in STATE_PRODUCING_COMMANDS
        or (target == DEFAULT_STATE_TARGET and not persist_default_target)
    ):
        return False

    run_results_path = project_path / "target" / "run_results.json"
    current_mtime = _file_mtime_ns(run_results_path)
    if current_mtime is None or (
        run_results_mtime_before is not None
        and current_mtime <= run_results_mtime_before
    ):
        return False

    try:
        saved = await asyncio.to_thread(state.save, project_id, target, project_path)
        if not saved:
            logger.warning(
                "Successful dbt command for %s/%s produced no manifest to save",
                project_id,
                target,
            )
        return saved
    except Exception as exc:
        logger.warning(
            "Could not save dbt state for %s/%s: %s", project_id, target, exc
        )
        return False


def resolve_request_state(
    state: "StateService",
    request: Any,
    command_name: str,
    project_path: Path,
    resolved: Optional[Path] = None,
    *,
    project_id: Optional[str] = None,
) -> Optional[Path]:
    """Check a request's state options and return the --state dir to append.

    Shared by the synchronous command path and run_launcher so both refuse the
    same requests - the launcher before it writes a History row.
    """
    if request.favor_state and not request.defer:
        raise DbtOperationError("state", "favor_state requires defer to also be enabled")
    if request.defer and not request.state_target:
        raise DbtOperationError("state", "state_target is required when defer is enabled")
    if command_name == "retry":
        # For retry, --state names where the *previous run_results* live, so a
        # saved target state would replay that target's last run instead.
        if request.state_target or request.defer:
            raise DbtOperationError(
                "retry",
                "dbt retry reuses the failed run's own state options; "
                "state_target and defer are not accepted",
            )
        retry_state_dir = getattr(request, "_retry_state_dir", None)
        if retry_state_dir is not None:
            # The retry endpoint already wrote the failed run's own
            # run_results.json into this private, run-scoped directory.
            # Nothing else may write there, so a dbt show/compile/preview on
            # the same project in between - none of which take the run lock -
            # cannot replace it out from under this retry the way it can
            # target/run_results.json.
            return Path(retry_state_dir)
        # Reached only via the generic /dbt/command path with command="retry"
        # (not the dedicated retry endpoint, so there is no private directory
        # to point at): fall back to plain `dbt retry` semantics, reading
        # whatever is currently in target/run_results.json.
        state.require_retry_results(project_path)
        return None
    if command_name == "clone" and not request.state_target:
        raise DbtOperationError("clone", "state_target is required for dbt clone")
    if not request.state_target:
        return None
    validate_target_name(request.state_target)
    request_project_id = project_id or getattr(request, "project_id", None)
    return resolved or state.require_state(request_project_id, request.state_target)


class StateService:
    """Store immutable inputs for dbt state comparison outside the workspace."""

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = Path(base_dir or settings.storage_dir) / "state"

    def project_dir(self, project_id: str) -> Path:
        return self.base_dir / _validate_project_id(project_id)

    def target_dir(self, project_id: str, target: str) -> Path:
        return self.project_dir(project_id) / validate_target_name(target)

    def require_state(self, project_id: str, target: str) -> Path:
        path = self.target_dir(project_id, target)
        if not (path / "manifest.json").is_file():
            raise DbtOperationError(
                "state",
                f"no saved dbt state exists for target '{target}'; "
                "run a build on that target successfully first",
            )
        return path

    @staticmethod
    def require_retry_results(project_path: Path) -> Path:
        path = project_path / "target" / "run_results.json"
        if not path.is_file():
            raise DbtOperationError(
                "retry",
                "no previous run to retry; target/run_results.json is missing",
            )
        return path

    @classmethod
    def load_retry_results(cls, project_path: Path) -> Dict[str, Any]:
        path = cls.require_retry_results(project_path)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise DbtOperationError(
                "retry", "target/run_results.json could not be read"
            ) from None
        if not isinstance(data, dict):
            raise DbtOperationError("retry", "target/run_results.json is not valid")
        return data

    def retry_dir(self, project_id: str, run_id: str) -> Path:
        """A private, run-scoped directory holding one failed run's own results.

        Keyed by run id rather than by target: unlike target/run_results.json,
        nothing but write_retry_results ever writes here, so a dbt
        show/compile/preview on the same project - none of which take the run
        lock - cannot replace it between the retry endpoint's checks and the
        `dbt retry` subprocess actually reading it.
        """
        return self.project_dir(project_id) / ".retry" / _validate_run_id(run_id)

    def write_retry_results(
        self, project_id: str, run_id: str, results: Dict[str, Any]
    ) -> Path:
        """Write a failed run's stored results for `dbt retry --state DIR`.

        dbt's RetryTask (dbt/task/retry.py) reads only DIR/run_results.json
        for the previous invocation's args and node statuses; it re-parses the
        project's own manifest rather than reading one from DIR, so nothing
        else needs to be written here.
        """
        directory = self.retry_dir(project_id, run_id)
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / "run_results.json"
        fd, temporary_name = tempfile.mkstemp(
            prefix=".run_results.", suffix=".tmp", dir=directory
        )
        os.close(fd)
        temporary = Path(temporary_name)
        try:
            temporary.write_text(json.dumps(results), encoding="utf-8")
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return directory

    def delete_retry_dir(self, project_id: str, run_id: str) -> None:
        """Best-effort cleanup once a retry run has finished."""
        shutil.rmtree(self.retry_dir(project_id, run_id), ignore_errors=True)

    @staticmethod
    def _copy_atomic(source: Path, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
        )
        os.close(fd)
        temporary = Path(temporary_name)
        try:
            shutil.copy2(source, temporary)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def save(self, project_id: str, target: str, project_path: Path) -> bool:
        """Atomically refresh a target's manifest and optional run results.

        run_results goes first: manifest.json is what marks a state as present,
        so a reader never sees a new manifest beside a missing results file.
        """
        source_dir = project_path / "target"
        manifest = source_dir / "manifest.json"
        if not manifest.is_file():
            return False

        destination = self.target_dir(project_id, target)
        run_results = source_dir / "run_results.json"
        saved_run_results = destination / "run_results.json"
        if run_results.is_file():
            self._copy_atomic(run_results, saved_run_results)
        else:
            saved_run_results.unlink(missing_ok=True)
        self._copy_atomic(manifest, destination / "manifest.json")
        return True

    def list_targets(self, project_id: str) -> List[Dict[str, Any]]:
        project_dir = self.project_dir(project_id)
        if not project_dir.is_dir():
            return []
        states: List[Dict[str, Any]] = []
        for path in sorted(project_dir.iterdir(), key=lambda item: item.name):
            if not path.is_dir() or not TARGET_NAME_RE.fullmatch(path.name):
                continue
            manifest = path / "manifest.json"
            if not manifest.is_file():
                continue
            states.append(
                {
                    "target": path.name,
                    "manifest": True,
                    "run_results": (path / "run_results.json").is_file(),
                    "updated_at": datetime.fromtimestamp(
                        manifest.stat().st_mtime, timezone.utc
                    ).isoformat(),
                }
            )
        return states

    def delete_target(self, project_id: str, target: str) -> bool:
        path = self.target_dir(project_id, target)
        if not path.exists():
            return False
        shutil.rmtree(path)
        project_dir = path.parent
        if project_dir.exists() and not any(project_dir.iterdir()):
            project_dir.rmdir()
        return True

    def delete_project(self, project_id: str) -> bool:
        project_dir = self.project_dir(project_id)
        if not project_dir.exists():
            return False
        shutil.rmtree(project_dir)
        return True
