"""Parsing and redaction for the dbt commands with their own endpoints.

`dbt ls`, `dbt debug` and `dbt run-operation` run through DbtService like any
other command; what is specific to each - reading ls JSON lines, keeping
secrets out of debug output, and finding a macro in the manifest - lives here
so it can be tested without running dbt.
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import yaml

from app.exceptions import DbtOperationError

# dbt's own --resource-type choices (dbt/cli/params.py).
LS_RESOURCE_TYPES = frozenset(
    {
        "metric",
        "semantic_model",
        "saved_query",
        "source",
        "analysis",
        "model",
        "test",
        "unit_test",
        "exposure",
        "snapshot",
        "seed",
        "default",
        "all",
    }
)
LS_MAX_ROWS = 5000
_LS_CONFIG_KEYS = ("materialized", "enabled", "schema", "database")

# Server-side allowlist for POST /dbt/init. A template other than "empty" would
# be a directory in this repository copied over the `dbt init` skeleton; none
# ships today, so the only choice is plain `dbt init`.
INIT_TEMPLATES = ("empty",)

MACRO_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# Keys whose values are credentials in any adapter's profile.
_SECRET_KEYS = frozenset(
    {
        "password",
        "pass",
        "pat",
        "token",
        "secret",
        "private_key",
        "private_key_passphrase",
        "keyfile_json",
        "client_secret",
        "refresh_token",
        "access_token",
        "api_key",
    }
)
REDACTED = "***REDACTED***"
_MIN_SECRET_LENGTH = 4


def validate_resource_types(resource_types: Optional[Iterable[str]]) -> List[str]:
    chosen = [str(item).lower() for item in resource_types or []]
    unknown = sorted(set(chosen) - LS_RESOURCE_TYPES)
    if unknown:
        raise DbtOperationError(
            "command validation",
            f"unknown resource type(s) {', '.join(unknown)}; "
            f"expected one of {', '.join(sorted(LS_RESOURCE_TYPES))}",
        )
    return chosen


def _ls_row(node: Dict[str, Any]) -> Dict[str, Any]:
    config = node.get("config") if isinstance(node.get("config"), dict) else {}
    depends_on = node.get("depends_on") if isinstance(node.get("depends_on"), dict) else {}
    return {
        "unique_id": node.get("unique_id"),
        "name": node.get("name"),
        "resource_type": node.get("resource_type"),
        "package_name": node.get("package_name"),
        "original_file_path": node.get("original_file_path"),
        "alias": node.get("alias"),
        "source_name": node.get("source_name"),
        "tags": node.get("tags") or [],
        "depends_on": depends_on.get("nodes") or [],
        "config": {key: config.get(key) for key in _LS_CONFIG_KEYS if key in config},
    }


def parse_ls_output(stdout: str) -> Dict[str, Any]:
    """Rows from `dbt ls --output json`: one JSON object per line among the logs."""
    rows: List[Dict[str, Any]] = []
    truncated = False
    for line in stdout.splitlines():
        text = _ANSI_RE.sub("", line).strip()
        if not text.startswith("{"):
            continue
        try:
            node = json.loads(text)
        except ValueError:
            continue
        if not isinstance(node, dict) or "unique_id" not in node:
            continue
        if len(rows) >= LS_MAX_ROWS:
            truncated = True
            break
        rows.append(_ls_row(node))
    return {"rows": rows, "count": len(rows), "truncated": truncated}


def _profile_secret_values(profiles_path: Path) -> List[str]:
    """Literal credential values in a hand-written profiles.yml."""
    try:
        document = yaml.safe_load(profiles_path.read_text()) or {}
    except (OSError, yaml.YAMLError):
        return []
    found: List[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).lower() in _SECRET_KEYS and isinstance(item, (str, int)):
                    found.append(str(item))
                else:
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(document)
    return found


def redact_output(
    output: str,
    *,
    secrets: Iterable[str],
    project_path: Optional[Path] = None,
) -> str:
    """Strip colour codes and every known secret value from dbt output.

    Redaction is by value, not by line shape: `dbt debug` prints whichever
    connection keys the adapter declares, and a secret can also surface inside
    a driver's error message. The values come from the run's environment (the
    profile secret and the project's stored variables) and from any literal
    credential in profiles.yml.
    """
    values = {str(value) for value in secrets if value and len(str(value)) >= _MIN_SECRET_LENGTH}
    if project_path is not None:
        values.update(
            value
            for value in _profile_secret_values(project_path / "profiles.yml")
            if len(value) >= _MIN_SECRET_LENGTH
        )
    cleaned = _ANSI_RE.sub("", output)
    # Longest first, so a secret containing another is replaced whole.
    for value in sorted(values, key=len, reverse=True):
        cleaned = cleaned.replace(value, REDACTED)
    if project_path is not None:
        cleaned = cleaned.replace(str(project_path), "<project>")
    return cleaned


def load_manifest(project_path: Path) -> Optional[Dict[str, Any]]:
    path = project_path / "target" / "manifest.json"
    if not path.is_file():
        return None
    try:
        manifest = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return manifest if isinstance(manifest, dict) else None


def _split_top_level(text: str) -> List[str]:
    parts, depth, quote, current = [], 0, "", []
    for char in text:
        if quote:
            current.append(char)
            if char == quote:
                quote = ""
            continue
        if char in "'\"":
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    if "".join(current).strip():
        parts.append("".join(current))
    return parts


def macro_signature(macro_sql: str, name: str) -> List[Dict[str, Optional[str]]]:
    """Argument names and defaults from `{% macro name(a, b=1) %}`.

    The manifest's `arguments` list is filled only for macros documented in
    YAML; the signature itself is always in the SQL, and it is what an args
    form needs.
    """
    match = re.search(
        r"{%-?\s*macro\s+" + re.escape(name) + r"\s*\(", macro_sql or ""
    )
    if not match:
        return []
    depth, start = 1, match.end()
    for index in range(start, len(macro_sql)):
        char = macro_sql[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                inner = macro_sql[start:index]
                break
    else:
        return []
    signature = []
    for part in _split_top_level(inner):
        arg_name, _, default = part.partition("=")
        arg_name = arg_name.strip()
        if arg_name:
            signature.append({"name": arg_name, "default": default.strip() or None})
    return signature


def _user_packages(manifest: Dict[str, Any], project_path: Path) -> set:
    packages = {str((manifest.get("metadata") or {}).get("project_name") or "")}
    installed = project_path / "dbt_packages"
    if installed.is_dir():
        packages.update(child.name for child in installed.iterdir() if child.is_dir())
    return packages - {""}


def list_macros(
    manifest: Dict[str, Any], project_path: Path, *, include_internal: bool = False
) -> List[Dict[str, Any]]:
    """Macros for the run-operation picker: the project's and its packages'.

    dbt's own and the adapter's macros (several hundred) are left out unless
    asked for - they are what the project calls, not what a user runs.
    """
    user_packages = _user_packages(manifest, project_path)
    macros = []
    for unique_id, macro in (manifest.get("macros") or {}).items():
        if not isinstance(macro, dict):
            continue
        package = macro.get("package_name")
        if not include_internal and package not in user_packages:
            continue
        name = macro.get("name") or unique_id.split(".")[-1]
        documented = macro.get("arguments") if isinstance(macro.get("arguments"), list) else []
        macros.append(
            {
                "unique_id": unique_id,
                "name": name,
                "package_name": package,
                "description": macro.get("description") or None,
                "original_file_path": macro.get("original_file_path"),
                "arguments": [
                    {
                        "name": arg.get("name"),
                        "type": arg.get("type"),
                        "description": arg.get("description") or None,
                    }
                    for arg in documented
                    if isinstance(arg, dict)
                ],
                "signature": macro_signature(macro.get("macro_sql") or "", name),
            }
        )
    return sorted(macros, key=lambda item: (item["package_name"] or "", item["name"]))


def require_macro(manifest: Optional[Dict[str, Any]], macro: str) -> str:
    """The macro name if the manifest has it; refuse anything else."""
    if not MACRO_NAME_RE.fullmatch(macro or ""):
        raise DbtOperationError("run-operation", f"invalid macro name '{macro}'")
    if manifest is None:
        raise DbtOperationError(
            "run-operation",
            "the project has no manifest yet; run dbt parse (or any build) first",
        )
    package, _, name = macro.rpartition(".")
    for item in (manifest.get("macros") or {}).values():
        if not isinstance(item, dict) or item.get("name") != name:
            continue
        if not package or item.get("package_name") == package:
            return macro
    raise DbtOperationError("run-operation", f"the manifest has no macro named '{macro}'")
