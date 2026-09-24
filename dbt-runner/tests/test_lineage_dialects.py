"""Column lineage uses the dialect recorded in the compiled manifest."""

import json

import app.lineage as lineage_module
from app.lineage import get_full_lineage


def _write_lineage_artifacts(tmp_path, compiled_sql: str, adapter_type: str = "databricks"):
    target = tmp_path / "target"
    compiled = target / "compiled" / "project" / "models"
    compiled.mkdir(parents=True)
    manifest = {
        "metadata": {"adapter_type": adapter_type},
        "nodes": {
            "model.project.orders_report": {
                "name": "orders_report",
                "resource_type": "model",
                "database": "catalog1",
                "schema": "schema1",
                "columns": {"order_id": {"data_type": "bigint"}},
                "depends_on": {"nodes": ["source.project.orders"]},
            }
        },
        "sources": {
            "source.project.orders": {
                "name": "orders",
                "identifier": "orders",
                "database": "catalog1",
                "schema": "schema1",
                "columns": {"id": {"data_type": "bigint"}},
            }
        },
        "child_map": {},
    }
    (target / "manifest.json").write_text(json.dumps(manifest))
    (compiled / "orders_report.sql").write_text(compiled_sql)


def test_databricks_backtick_compiled_sql_uses_manifest_adapter_dialect(tmp_path):
    _write_lineage_artifacts(
        tmp_path,
        "SELECT `orders`.`id` AS `order_id` "
        "FROM `catalog1`.`schema1`.`orders` AS `orders`",
    )

    result = get_full_lineage(tmp_path, "orders_report")

    assert result["success"] is True
    assert result["column_lineage_error"] is None
    assert "order_id" in result["column_lineage"]
    assert isinstance(result["column_lineage"]["order_id"], list)


def test_column_lineage_failure_is_separate_and_strips_ansi(tmp_path, monkeypatch):
    _write_lineage_artifacts(tmp_path, "SELECT 1 AS order_id")

    def fail_parse(*_args, **_kwargs):
        raise ValueError("\x1b[31mExpecting )\x1b[0m")

    monkeypatch.setattr(lineage_module, "parse_one", fail_parse)
    result = get_full_lineage(tmp_path, "orders_report")

    assert result["column_lineage"] == {}
    assert result["column_lineage_error"] == "Failed to parse SQL: Expecting )"
    assert "\x1b" not in result["column_lineage_error"]
