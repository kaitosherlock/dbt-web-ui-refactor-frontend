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


def _write_star_lineage_artifacts(
    tmp_path,
    compiled_sql: str,
    adapter_type: str,
    database: str,
    schema: str,
    *,
    catalog: bool,
):
    target = tmp_path / "target"
    compiled = target / "compiled" / "project" / "models"
    compiled.mkdir(parents=True)

    fallback_columns = {
        "model.project.stg_customers": {
            "customer_id": {"data_type": "bigint"},
            "first_name": {"data_type": "text"},
        },
        "model.project.stg_orders": {
            "customer_id": {"data_type": "bigint"},
            "order_id": {"data_type": "bigint"},
        },
    }
    nodes = {
        "model.project.customer_orders": {
            "name": "customer_orders",
            "resource_type": "model",
            "database": database,
            "schema": schema,
            "columns": {},
            "depends_on": {
                "nodes": [
                    "model.project.stg_customers",
                    "model.project.stg_orders",
                ]
            },
        }
    }
    for model_name in ("stg_customers", "stg_orders"):
        node_id = f"model.project.{model_name}"
        nodes[node_id] = {
            "name": model_name,
            "identifier": model_name.upper(),
            "resource_type": "model",
            "database": database.upper(),
            "schema": schema.upper(),
            "columns": {} if catalog else fallback_columns[node_id],
            "depends_on": {"nodes": []},
        }

    manifest = {
        "metadata": {"adapter_type": adapter_type},
        "nodes": nodes,
        "sources": {},
        "child_map": {},
    }
    (target / "manifest.json").write_text(json.dumps(manifest))
    (compiled / "customer_orders.sql").write_text(compiled_sql)

    if catalog:
        catalog_nodes = {}
        for node_id, columns in fallback_columns.items():
            catalog_nodes[node_id] = {
                "columns": {
                    name: {"name": name, "type": details["data_type"]}
                    for name, details in columns.items()
                }
            }
        (target / "catalog.json").write_text(
            json.dumps({"nodes": catalog_nodes, "sources": {}})
        )


def _assert_star_lineage(result):
    assert result["success"] is True
    assert result["column_lineage_error"] is None
    assert set(result["column_lineage"]) == {
        "customer_id",
        "first_name",
        "order_id",
    }
    assert any(
        source["column"] == "first_name"
        and source["table"].endswith("stg_customers")
        for source in result["column_lineage"]["first_name"]
    )
    assert any(
        source["column"] == "order_id"
        and source["table"].endswith("stg_orders")
        for source in result["column_lineage"]["order_id"]
    )


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


def test_databricks_cte_star_uses_catalog_columns_for_qualified_relations(tmp_path):
    _write_star_lineage_artifacts(
        tmp_path,
        """
        WITH `a` AS (
            SELECT `customer_id`, `first_name`
            FROM `catalog1`.`schema1`.`stg_customers`
        ),
        `b` AS (
            SELECT `a`.`customer_id`, `a`.`first_name`, `orders`.`order_id`
            FROM `a`
            JOIN `catalog1`.`schema1`.`stg_orders` AS `orders`
              ON `a`.`customer_id` = `orders`.`customer_id`
        )
        SELECT * FROM `b`
        """,
        "databricks",
        "catalog1",
        "schema1",
        catalog=True,
    )

    _assert_star_lineage(get_full_lineage(tmp_path, "customer_orders"))


def test_postgres_cte_star_uses_three_part_catalog_schema(tmp_path):
    _write_star_lineage_artifacts(
        tmp_path,
        """
        WITH a AS (
            SELECT customer_id, first_name
            FROM crm.dbt_e2e.stg_customers
        ),
        b AS (
            SELECT a.customer_id, a.first_name, orders.order_id
            FROM a
            JOIN crm.dbt_e2e.stg_orders AS orders
              ON a.customer_id = orders.customer_id
        )
        SELECT * FROM b
        """,
        "postgres",
        "crm",
        "dbt_e2e",
        catalog=True,
    )

    _assert_star_lineage(get_full_lineage(tmp_path, "customer_orders"))


def test_cte_star_falls_back_to_manifest_columns_without_catalog(tmp_path):
    _write_star_lineage_artifacts(
        tmp_path,
        """
        WITH a AS (
            SELECT customer_id, first_name
            FROM crm.dbt_e2e.stg_customers
        ),
        b AS (
            SELECT a.customer_id, a.first_name, orders.order_id
            FROM a
            JOIN crm.dbt_e2e.stg_orders AS orders
              ON a.customer_id = orders.customer_id
        )
        SELECT * FROM b
        """,
        "postgres",
        "crm",
        "dbt_e2e",
        catalog=False,
    )

    _assert_star_lineage(get_full_lineage(tmp_path, "customer_orders"))


def test_relation_without_columns_does_not_block_known_column_lineage(tmp_path):
    _write_star_lineage_artifacts(
        tmp_path,
        """
        WITH a AS (
            SELECT customer_id
            FROM crm.dbt_e2e.stg_customers
        ),
        b AS (
            SELECT a.customer_id, unknown.first_name
            FROM a
            JOIN crm.dbt_e2e.stg_unknown AS unknown
              ON a.customer_id = unknown.customer_id
        )
        SELECT * FROM b
        """,
        "postgres",
        "crm",
        "dbt_e2e",
        catalog=True,
    )
    manifest_path = tmp_path / "target" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["nodes"]["model.project.customer_orders"]["depends_on"]["nodes"].append(
        "model.project.stg_unknown"
    )
    manifest["nodes"]["model.project.stg_unknown"] = {
        "name": "stg_unknown",
        "identifier": "STG_UNKNOWN",
        "resource_type": "model",
        "database": "CRM",
        "schema": "DBT_E2E",
        "columns": {},
        "depends_on": {"nodes": []},
    }
    manifest_path.write_text(json.dumps(manifest))

    result = get_full_lineage(tmp_path, "customer_orders")

    assert set(result["column_lineage"]) == {"customer_id", "first_name"}
    assert any(
        source["column"] == "customer_id"
        and source["table"].endswith("stg_customers")
        for source in result["column_lineage"]["customer_id"]
    )


def test_column_lineage_failure_is_separate_and_strips_ansi(tmp_path, monkeypatch):
    _write_lineage_artifacts(tmp_path, "SELECT 1 AS order_id")

    def fail_parse(*_args, **_kwargs):
        raise ValueError("\x1b[31mExpecting )\x1b[0m")

    monkeypatch.setattr(lineage_module, "parse_one", fail_parse)
    result = get_full_lineage(tmp_path, "orders_report")

    assert result["column_lineage"] == {}
    assert result["column_lineage_error"] == "Failed to parse SQL: Expecting )"
    assert "\x1b" not in result["column_lineage_error"]
