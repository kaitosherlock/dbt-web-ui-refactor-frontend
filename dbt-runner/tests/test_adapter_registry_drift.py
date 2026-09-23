"""adapters/__init__.py and the connection form offer the same warehouses.

CLAUDE.md: "adapters/__init__.py is the registry - keep it in step with
ConnectionDialog.tsx". A warehouse in the registry but not the form cannot be
created; one in the form but not the registry produces connections every run
fails on. The dialog is read as text, never imported - dbt-runner has no
frontend toolchain - and the test skips where the frontend is not checked out
(the dbt-runner image).
"""

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters import ADAPTERS

DIALOG = (
    Path(__file__).resolve().parents[2]
    / "nextjs/src/components/connections/ConnectionDialog.tsx"
)

# Connection types the form offers that are deliberately not warehouses: a
# lakehouse sits beside one, and the other two are read-only ingest sources.
# Each is refused as a project's warehouse with a message
# (build_adapter_config_from_connection_row).
NOT_WAREHOUSES = {"ducklake", "mysql", "rest"}

# Registry entries whose form is a pending frontend follow-up. Remove a name
# here in the same change that adds it to ConnectionDialog.tsx - the strict
# xfail below turns into a failure until you do.
PENDING_IN_DIALOG = {"snowflake", "databricks"}


def _dialog_types() -> set[str]:
    if not DIALOG.exists():
        pytest.skip("frontend not checked out next to dbt-runner")
    source = DIALOG.read_text(encoding="utf-8")
    match = re.search(r"type ConnectionType\s*=(.*?)\n\n", source, re.S)
    assert match, "ConnectionType union not found in ConnectionDialog.tsx"
    # Comments inside the union may quote words; only the union's members count.
    body = re.sub(r"//[^\n]*", "", match.group(1))
    types = set(re.findall(r'"([a-z_]+)"', body))
    assert types, "ConnectionType union has no members"
    return types


def test_every_warehouse_in_the_dialog_has_an_adapter():
    offered = _dialog_types() - NOT_WAREHOUSES
    assert offered - set(ADAPTERS) == set(), (
        "ConnectionDialog.tsx offers warehouses dbt-runner has no adapter for"
    )


def test_every_adapter_is_in_the_dialog_except_pending_follow_ups():
    missing = set(ADAPTERS) - _dialog_types()
    assert missing - PENDING_IN_DIALOG == set(), (
        "adapters registered in dbt-runner but not offered by ConnectionDialog.tsx"
    )


@pytest.mark.parametrize("name", sorted(PENDING_IN_DIALOG))
@pytest.mark.xfail(
    strict=True,
    reason="backend adapter added; ConnectionDialog.tsx form is a frontend follow-up",
)
def test_pending_adapter_is_in_the_dialog(name):
    assert name in _dialog_types()


def test_pending_list_only_names_registered_adapters():
    assert PENDING_IN_DIALOG <= set(ADAPTERS)
