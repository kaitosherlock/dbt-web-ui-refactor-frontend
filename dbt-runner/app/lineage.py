"""
Data Lineage Module for dbt-runner.

Uses dbt manifest.json for table-level lineage and sqlglot for column-level lineage.
"""

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional

# Conditional import for sqlglot
SQLGLOT_AVAILABLE = False

ANSI_ESCAPE_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
SQLGLOT_DIALECT_BY_ADAPTER = {
    "databricks": "databricks",
    "snowflake": "snowflake",
    "postgresql": "postgres",
    "postgres": "postgres",
    "duckdb": "duckdb",
    "oracle": "oracle",
    "spark": "spark",
    # sqlglot has no Dremio dialect. Its generic parser is the least
    # surprising fallback for compiled Dremio SQL.
    "dremio": None,
}

try:
    from sqlglot import Dialect, exp, parse_one
    from sqlglot.lineage import lineage
    from sqlglot.optimizer.qualify import qualify
    from sqlglot.optimizer.scope import build_scope
    from sqlglot.schema import MappingSchema

    SQLGLOT_AVAILABLE = True
except ImportError:
    pass


@dataclass
class LineageNode:
    """Represents a node in the lineage graph."""

    id: str
    name: str
    type: str  # 'model', 'source', 'seed', 'snapshot'
    schema: Optional[str] = None
    database: Optional[str] = None
    position: Optional[str] = None  # 'upstream', 'current', 'downstream'
    columns: Optional[List[str]] = None


@dataclass
class LineageEdge:
    """Represents an edge (dependency) in the lineage graph."""

    from_node: str
    to_node: str


@dataclass
class ColumnLineage:
    """Represents column-level lineage information."""

    column: str
    source_column: str
    source_table: str
    transformation: Optional[str] = None


class ColumnLineageAnalysisError(ValueError):
    """Column lineage could not be produced for the compiled query."""


def clean_error_message(error: Any) -> str:
    """Return a single safe error string without terminal colour controls."""
    return ANSI_ESCAPE_RE.sub("", str(error)).strip()


def sqlglot_dialect_for_adapter(adapter_type: Any) -> Optional[str]:
    """Map the adapter that compiled an artifact to sqlglot's reader name."""
    name = str(adapter_type or "").strip().lower()
    return SQLGLOT_DIALECT_BY_ADAPTER.get(name)


def parse_manifest(manifest_path: Path) -> Dict[str, Any]:
    """Load and parse dbt manifest.json."""
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    with open(manifest_path, "r") as f:
        return json.load(f)


def get_node_type(node_id: str) -> str:
    """Extract node type from dbt node ID."""
    # Format: model.project.name, source.project.name, seed.project.name
    parts = node_id.split(".")
    if parts:
        return parts[0]
    return "unknown"


def get_node_name(node_id: str) -> str:
    """Extract node name from dbt node ID."""
    parts = node_id.split(".")
    if len(parts) >= 3:
        return parts[-1]
    return node_id


def get_table_lineage(manifest: Dict[str, Any], model_name: str) -> Dict[str, Any]:
    """
    Extract table-level lineage from dbt manifest.

    Returns upstream dependencies, current model, and downstream dependents.
    """
    nodes: List[LineageNode] = []
    edges: List[LineageEdge] = []

    # Find the current model
    current_node_id = None
    for node_id, node_data in manifest.get("nodes", {}).items():
        if node_data.get("name") == model_name:
            current_node_id = node_id
            break

    if not current_node_id:
        # Also check sources
        for source_id, source_data in manifest.get("sources", {}).items():
            if source_data.get("name") == model_name:
                current_node_id = source_id
                break

    if not current_node_id:
        return {
            "nodes": [],
            "edges": [],
            "error": f"Model '{model_name}' not found in manifest",
        }

    current_data = manifest["nodes"].get(current_node_id) or manifest.get(
        "sources", {}
    ).get(current_node_id, {})

    # Add current node
    current_node = LineageNode(
        id=current_node_id,
        name=model_name,
        type=get_node_type(current_node_id),
        schema=current_data.get("schema"),
        database=current_data.get("database"),
        position="current",
        columns=list(current_data.get("columns", {}).keys()) or None,
    )
    nodes.append(current_node)

    # Get upstream dependencies
    depends_on = current_data.get("depends_on", {}).get("nodes", [])
    for dep_id in depends_on:
        dep_data = manifest["nodes"].get(dep_id) or manifest.get("sources", {}).get(
            dep_id, {}
        )
        if dep_data:
            upstream_node = LineageNode(
                id=dep_id,
                name=get_node_name(dep_id),
                type=get_node_type(dep_id),
                schema=dep_data.get("schema"),
                database=dep_data.get("database"),
                position="upstream",
                columns=list(dep_data.get("columns", {}).keys()) or None,
            )
            nodes.append(upstream_node)
            # Edges reference node IDs (not names) so the frontend can match them
            # against node positions, which are keyed by node.id.
            edges.append(LineageEdge(from_node=dep_id, to_node=current_node_id))

    # Get downstream dependents (models that depend on this model)
    child_map = manifest.get("child_map", {})
    downstream_ids = child_map.get(current_node_id, [])
    for child_id in downstream_ids:
        child_data = manifest["nodes"].get(child_id, {})
        if child_data and child_data.get("resource_type") == "model":
            downstream_node = LineageNode(
                id=child_id,
                name=get_node_name(child_id),
                type=get_node_type(child_id),
                schema=child_data.get("schema"),
                database=child_data.get("database"),
                position="downstream",
                columns=list(child_data.get("columns", {}).keys()) or None,
            )
            nodes.append(downstream_node)
            edges.append(LineageEdge(from_node=current_node_id, to_node=child_id))

    return {
        "nodes": [asdict(n) for n in nodes],
        "edges": [{"from": e.from_node, "to": e.to_node} for e in edges],
    }


def _leaf_sources(node: Any) -> List[Dict[str, str]]:
    """Walk a sqlglot lineage Node to its leaves and return source columns.

    Leaf node names are table-qualified (e.g. ``raw_orders.id``). The leaf is
    the ultimate origin of the output column.
    """
    sources: List[Dict[str, str]] = []
    seen: set = set()

    def unquote(identifier: str) -> str:
        if len(identifier) >= 2 and (
            identifier[0] == identifier[-1] and identifier[0] in {'"', "`"}
        ):
            return identifier[1:-1]
        if identifier.startswith("[") and identifier.endswith("]"):
            return identifier[1:-1]
        return identifier

    def walk(n: Any) -> None:
        if not n.downstream:
            name = n.name or ""
            # Split "schema.table.column" / "table.column" -> table, column
            if "." in name:
                table, column = name.rsplit(".", 1)
            else:
                table, column = "unknown", name
            column = unquote(column)
            if isinstance(n.expression, exp.Table):
                # A leaf's node name uses the query alias. Report the physical
                # relation from its expression instead.
                table = ".".join(part.name for part in n.expression.parts)
            else:
                table = ".".join(unquote(part) for part in table.split("."))
            key = (table, column)
            if column and key not in seen:
                seen.add(key)
                sources.append(
                    {
                        "column": column,
                        "table": table,
                        "expression": str(n.expression)[:150] if n.expression else "",
                    }
                )
            return
        for child in n.downstream:
            walk(child)

    walk(node)
    return sources


def _normalise_identifier(name: Any, dialect: Optional[str]) -> str:
    """Normalise an artifact or parsed SQL identifier using the target dialect."""
    identifier = (
        name.copy()
        if isinstance(name, exp.Identifier)
        else exp.to_identifier(str(name or ""))
    )
    return Dialect.get_or_raise(dialect).normalize_identifier(identifier).name


def _relation_key(parts: List[Any], dialect: Optional[str]) -> tuple[str, ...]:
    """Return the dialect-normalised, non-empty parts of a relation name."""
    return tuple(
        _normalise_identifier(part, dialect)
        for part in parts
        if part is not None and str(part)
    )


def _upstream_relations(
    manifest: Dict[str, Any], model_name: str
) -> Dict[str, Dict[str, Any]]:
    """Return the transitive manifest relations upstream of ``model_name``."""
    relations = {**manifest.get("nodes", {}), **manifest.get("sources", {})}
    current_id = next(
        (
            node_id
            for node_id, node_data in relations.items()
            if node_data.get("name") == model_name
        ),
        None,
    )
    if current_id is None:
        return {}

    upstream: Dict[str, Dict[str, Any]] = {}
    pending = list(relations[current_id].get("depends_on", {}).get("nodes", []))
    while pending:
        node_id = pending.pop()
        if node_id in upstream:
            continue
        node_data = relations.get(node_id)
        if not node_data:
            continue
        upstream[node_id] = node_data
        pending.extend(node_data.get("depends_on", {}).get("nodes", []))
    return upstream


def _artifact_columns(
    node_id: str,
    node_data: Dict[str, Any],
    catalog: Dict[str, Any],
) -> Dict[str, str]:
    """Prefer catalog columns for a relation, falling back to manifest columns."""
    catalog_entry = catalog.get("nodes", {}).get(node_id) or catalog.get(
        "sources", {}
    ).get(node_id)
    catalog_columns = catalog_entry.get("columns") if catalog_entry else None
    artifact_columns = catalog_columns or node_data.get("columns", {})

    columns: Dict[str, str] = {}
    for key, column_data in artifact_columns.items():
        column_data = column_data or {}
        column_name = column_data.get("name") or key
        columns[column_name] = (
            column_data.get("type")
            or column_data.get("data_type")
            or "unknown"
        )
    return columns


def build_sqlglot_schema(
    compiled_sql: str,
    manifest: Dict[str, Any],
    catalog: Optional[Dict[str, Any]],
    model_name: str,
    dialect: Optional[str],
) -> Any:
    """Build a schema whose relation keys exactly match the compiled SQL.

    Manifest relation metadata identifies each physical upstream relation. The
    table expressions from the compiled query are used as the schema keys so
    quoting and qualification depth match what sqlglot parsed.
    """
    schema = MappingSchema(dialect=dialect, normalize=True)
    try:
        parsed = parse_one(compiled_sql, dialect=dialect)
    except Exception:
        # get_column_lineage owns parse error reporting and sanitisation.
        return schema
    upstream = _upstream_relations(manifest, model_name)
    catalog = catalog or {}

    relation_index: Dict[tuple[str, ...], List[tuple[str, Dict[str, Any]]]] = {}
    for node_id, node_data in upstream.items():
        identifier = (
            node_data.get("identifier")
            or node_data.get("alias")
            or node_data.get("name")
            or get_node_name(node_id)
        )
        full_key = _relation_key(
            [node_data.get("database"), node_data.get("schema"), identifier],
            dialect,
        )
        # Compiled relations can omit a database or both qualifiers. Index each
        # suffix, but only use unambiguous matches below.
        for depth in range(1, len(full_key) + 1):
            relation_index.setdefault(full_key[-depth:], []).append(
                (node_id, node_data)
            )

    for table in parsed.find_all(exp.Table):
        compiled_key = _relation_key(
            [table.args.get("catalog"), table.args.get("db"), table.this],
            dialect,
        )
        matches = relation_index.get(compiled_key, [])
        if len(matches) != 1:
            continue
        node_id, node_data = matches[0]
        columns = _artifact_columns(node_id, node_data, catalog)
        if columns:
            schema.add_table(
                table,
                columns,
                dialect=dialect,
                normalize=True,
                match_depth=False,
            )
    return schema


def get_column_lineage(
    compiled_sql: str,
    schema: Optional[Any] = None,
    dialect: Optional[str] = None,
    *,
    errors: Optional[List[str]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Analyze column-level lineage using sqlglot's built-in lineage engine.

    Args:
        compiled_sql: The compiled SQL query
        schema: Optional schema dict mapping table names to column definitions.
            Required to expand ``SELECT *`` and disambiguate multi-table joins.
        dialect: SQL dialect to parse with.

    Returns:
        Dict mapping each output column to its ultimate source columns.
    """
    if not SQLGLOT_AVAILABLE:
        raise ColumnLineageAnalysisError("sqlglot not available")

    try:
        parsed = parse_one(compiled_sql, dialect=dialect)
        qualified = qualify(
            parsed,
            dialect=dialect,
            schema=schema,
            identify=False,
            validate_qualify_columns=False,
        )
        output_columns = qualified.named_selects
        scope = build_scope(qualified)
    except Exception as e:
        raise ColumnLineageAnalysisError(
            f"Failed to parse SQL: {clean_error_message(e)}"
        ) from None

    if not output_columns:
        raise ColumnLineageAnalysisError("No output columns found")

    column_lineage: Dict[str, List[Dict[str, Any]]] = {}
    for output_col in output_columns:
        try:
            node = lineage(
                output_col,
                qualified,
                schema=schema,
                dialect=dialect,
                scope=scope,
            )
            column_lineage[output_col] = _leaf_sources(node)
        except Exception as e:
            column_lineage[output_col] = []
            if errors is not None:
                errors.append(
                    f"Failed to trace lineage for '{output_col}': "
                    f"{clean_error_message(e)}"
                )

    return column_lineage


def get_full_lineage(project_path: Path, model_name: str) -> Dict[str, Any]:
    """
    Get complete lineage information for a model.

    Combines table lineage from manifest and column lineage from compiled SQL.
    """
    target_path = project_path / "target"
    manifest_path = target_path / "manifest.json"

    result = {
        "success": False,
        "model": model_name,
        "table_lineage": {"nodes": [], "edges": []},
        "column_lineage": {},
        "column_lineage_error": None,
    }

    # Get table lineage from manifest
    if manifest_path.exists():
        try:
            manifest = parse_manifest(manifest_path)
            table_lineage = get_table_lineage(manifest, model_name)
            result["table_lineage"] = table_lineage
            if table_lineage.get("error"):
                # Model missing from manifest (usually a stale manifest:
                # model was created/renamed but not recompiled).
                result["error"] = (
                    f"{table_lineage['error']}. Run 'dbt compile' to refresh lineage."
                )
            else:
                result["success"] = True
        except Exception as e:
            result["error"] = f"Failed to parse manifest: {clean_error_message(e)}"
    else:
        result["error"] = "manifest.json not found. Run 'dbt compile' first."
        return result

    # Get column lineage from compiled SQL
    compiled_path = target_path / "compiled"
    if compiled_path.exists():
        # Find compiled SQL file for the model
        for sql_file in compiled_path.rglob(f"{model_name}.sql"):
            try:
                compiled_sql = sql_file.read_text()

                adapter_type = manifest.get("metadata", {}).get("adapter_type")
                dialect = sqlglot_dialect_for_adapter(adapter_type)
                catalog_path = target_path / "catalog.json"
                catalog = (
                    json.loads(catalog_path.read_text())
                    if catalog_path.exists()
                    else {}
                )
                schema = build_sqlglot_schema(
                    compiled_sql,
                    manifest,
                    catalog,
                    model_name,
                    dialect,
                )
                column_errors: List[str] = []
                result["column_lineage"] = get_column_lineage(
                    compiled_sql,
                    schema,
                    dialect=dialect,
                    errors=column_errors,
                )
                if column_errors:
                    result["column_lineage_error"] = "; ".join(column_errors)
            except Exception as e:
                result["column_lineage"] = {}
                result["column_lineage_error"] = clean_error_message(e)
            break

    return result
