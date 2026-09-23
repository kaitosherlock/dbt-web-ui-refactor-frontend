"""Server-owned dbt state artifacts.

Clients select a named target, never a filesystem path.  The path below is
therefore derived entirely from validated project and target identifiers.
"""

import json
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


def resolve_request_state(
    state: "StateService",
    request: Any,
    command_name: str,
    project_path: Path,
    resolved: Optional[Path] = None,
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
        state.require_retry_results(project_path)
        return None
    if command_name == "clone" and not request.state_target:
        raise DbtOperationError("clone", "state_target is required for dbt clone")
    if not request.state_target:
        return None
    validate_target_name(request.state_target)
    return resolved or state.require_state(request.project_id, request.state_target)


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
