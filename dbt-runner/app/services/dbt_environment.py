"""Validation and process isolation for environment variables exposed to dbt."""

from __future__ import annotations

import logging
import os
from collections.abc import Iterable, Mapping
from typing import Optional

from app.exceptions import DbtOperationError

logger = logging.getLogger(__name__)

ALLOWED_ENV_VAR_NAME_CHARS = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"
)
# Every profile secret this server renders lives under one prefix, and the
# whole prefix is reserved: a connection's main credential, its second secret
# (a Snowflake key's passphrase) and any secret a later adapter adds, each with
# a `__<TARGET>` suffix per extra target. A client that could set one of these
# names would replace another warehouse's credential in the run.
DBT_PROFILE_SECRET_PREFIX = "DBT_ENV_SECRET_DBT_CRAFT_"
DBT_PROFILE_SECRET_ENV = f"{DBT_PROFILE_SECRET_PREFIX}CREDENTIAL"
DBT_PROFILE_SECONDARY_SECRET_ENV = f"{DBT_PROFILE_SECRET_PREFIX}SECONDARY"
DBT_LAKE_CATALOG_PASSWORD_ENV = "DBT_ENV_SECRET_LAKE_CATALOG_PASSWORD"

# Keep a complete baseline in case dbt changes its import layout or a partially
# installed adapter makes CLI import fail. Discovery below adds new Click envvars
# automatically when dbt is upgraded.
FALLBACK_DBT_CLI_ENV_VARS = frozenset(
    {
        "DBT_ARTIFACT_STATE_PATH",
        "DBT_CACHE_SELECTED_ONLY",
        "DBT_CLEAN_PROJECT_FILES_ONLY",
        "DBT_DEBUG",
        "DBT_DEFER",
        "DBT_DEFER_STATE",
        "DBT_DEFER_TO_STATE",
        "DBT_EMPTY",
        "DBT_EVENT_TIME_END",
        "DBT_EVENT_TIME_START",
        "DBT_EXCLUDE_RESOURCE_TYPES",
        "DBT_EXPORT_SAVED_QUERIES",
        "DBT_FAIL_FAST",
        "DBT_FAVOR_STATE",
        "DBT_FAVOR_STATE_MODE",
        "DBT_FULL_REFRESH",
        "DBT_HOST",
        "DBT_INCLUDE_SAVED_QUERY",
        "DBT_INDIRECT_SELECTION",
        "DBT_INTROSPECT",
        "DBT_LOG_CACHE_EVENTS",
        "DBT_LOG_FILE_MAX_BYTES",
        "DBT_LOG_FORMAT",
        "DBT_LOG_FORMAT_FILE",
        "DBT_LOG_LEVEL",
        "DBT_LOG_LEVEL_FILE",
        "DBT_LOG_PATH",
        "DBT_MACRO_DEBUGGING",
        "DBT_NO_PRINT",
        "DBT_PACKAGES_INSTALL_PATH",
        "DBT_PARTIAL_PARSE",
        "DBT_PARTIAL_PARSE_FILE_DIFF",
        "DBT_PARTIAL_PARSE_FILE_PATH",
        "DBT_POPULATE_CACHE",
        "DBT_PRINT",
        "DBT_PRINTER_WIDTH",
        "DBT_PROFILE",
        "DBT_PROFILES_DIR",
        "DBT_PROJECT_DIR",
        "DBT_QUIET",
        "DBT_RESOURCE_TYPES",
        "DBT_SAMPLE",
        "DBT_SEND_ANONYMOUS_USAGE_STATS",
        "DBT_SHOW_RESOURCE_REPORT",
        "DBT_SINGLE_THREADED",
        "DBT_STATE",
        "DBT_STATIC_PARSER",
        "DBT_STORE_FAILURES",
        "DBT_TARGET",
        "DBT_TARGET_PATH",
        "DBT_UPLOAD_TO_ARTIFACTS_INGEST_API",
        "DBT_USE_COLORS",
        "DBT_USE_COLORS_FILE",
        "DBT_USE_EXPERIMENTAL_PARSER",
        "DBT_USE_FAST_TEST_EDGES",
        "DBT_VERSION_CHECK",
        "DBT_WARN_ERROR",
        "DBT_WARN_ERROR_OPTIONS",
        "DBT_WRITE_JSON",
    }
)


def _add_envvar(target: set[str], envvar: object) -> None:
    if isinstance(envvar, str):
        target.add(envvar.upper())
    elif isinstance(envvar, Iterable):
        for item in envvar:
            if isinstance(item, str):
                target.add(item.upper())


def _discover_dbt_cli_env_vars() -> frozenset[str]:
    """Read dbt's Click parameters once at import so upgrades stay covered."""
    try:
        from dbt.cli import params as dbt_params
        from dbt.cli.main import cli

        discovered: set[str] = set()
        _add_envvar(discovered, getattr(dbt_params, "KNOWN_ENV_VARS", ()))

        commands = [cli]
        seen: set[int] = set()
        while commands:
            command = commands.pop()
            if id(command) in seen:
                continue
            seen.add(id(command))
            for param in getattr(command, "params", ()):
                _add_envvar(discovered, getattr(param, "envvar", None))
            commands.extend(getattr(command, "commands", {}).values())

        if not discovered:
            raise RuntimeError("dbt exposed no CLI environment variables")
        return frozenset(discovered)
    except Exception as exc:
        logger.warning(
            "Could not inspect dbt CLI environment variables; using fallback: %s",
            exc,
        )
        return FALLBACK_DBT_CLI_ENV_VARS


DBT_CLI_ENV_VARS = frozenset(
    {*FALLBACK_DBT_CLI_ENV_VARS, *_discover_dbt_cli_env_vars()}
)


def _is_server_owned_name(name: str) -> bool:
    return name.startswith(DBT_PROFILE_SECRET_PREFIX) or name == DBT_LAKE_CATALOG_PASSWORD_ENV


def forbidden_dbt_environment_reason(
    name: str, *, allow_server_owned: bool = False
) -> Optional[str]:
    normalized = name.upper()
    if normalized in DBT_CLI_ENV_VARS:
        return "dbt treats it as a CLI option"
    if normalized in {"PATH", "HOME", "VIRTUAL_ENV"}:
        return "it controls the dbt process environment"
    if normalized.startswith(("PYTHON", "LD_", "DYLD_", "UV_")):
        return "it controls Python or native code loading"
    if not allow_server_owned and _is_server_owned_name(normalized):
        return "it is reserved for a server-managed credential"
    return None


def sanitize_dbt_environment(
    raw_env: Optional[Mapping[str, object]], *, allow_server_owned: bool = False
) -> dict[str, str]:
    """Validate untrusted dbt env vars, rejecting security-sensitive names."""
    if not raw_env:
        return {}

    sanitized: dict[str, str] = {}
    for key, value in raw_env.items():
        name = (key or "").strip()
        if not name:
            continue
        if len(name) > 128 or (not name[0].isalpha() and name[0] != "_"):
            continue
        if any(char not in ALLOWED_ENV_VAR_NAME_CHARS for char in name):
            continue
        reason = forbidden_dbt_environment_reason(
            name, allow_server_owned=allow_server_owned
        )
        if reason:
            raise DbtOperationError(
                "environment validation",
                f"environment variable '{name}' is not allowed because {reason}",
            )
        sanitized[name] = str(value)
    return sanitized


def dbt_process_environment(
    run_env: Optional[Mapping[str, object]] = None,
) -> dict[str, str]:
    """Build a dbt process env: the server's own env plus the validated overlay.

    The server's env is deployment config and is inherited unfiltered - the
    image sets DBT_SEND_ANONYMOUS_USAGE_STATS=false and compose sets
    DBT_PACKAGES_INSTALL_PATH, and stripping dbt option names here would turn
    dbt's telemetry back on. Only the per-run overlay is untrusted.
    """
    overlay = sanitize_dbt_environment(run_env, allow_server_owned=True)
    return {**os.environ, **overlay}
