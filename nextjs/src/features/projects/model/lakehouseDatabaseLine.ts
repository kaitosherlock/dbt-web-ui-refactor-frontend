/**
 * The `+database` line dbt-craft pins under a project's `models:` key, which
 * decides where dbt writes the models it builds. `lake` is only a valid
 * catalog name when the active target is dbt-duckdb — it is the DuckLake
 * catalog dbt-duckdb attaches alongside the warehouse. Every other adapter
 * (Databricks, Postgres, Snowflake, ...) has no catalog by that name, so a
 * literal `+database: lake` fails every build there with "Catalog 'lake' was
 * not found". A target-conditional Jinja expression keeps a duckdb target
 * writing into the lake while every other target falls back to its own
 * configured database.
 *
 * dbt-runner (`app/services/lakes.py`) is the single writer of this line —
 * edited as lines there too, never through a YAML round trip, since
 * dbt_project.yml ships full of comments that safe_load/safe_dump would
 * silently delete (see CLAUDE.md, "Lakehouse"). This module only *detects*
 * the line client-side, to warn about a stale literal before the backend gets
 * a chance to rewrite it.
 */

/** The value dbt-runner writes when at least one target isn't dbt-duckdb. */
export const CONDITIONAL_DATABASE_EXPR = `"{{ 'lake' if target.type == 'duckdb' else target.database }}"`

// `database:` or `+database:` pinned to the literal lake alias, quoted or not.
const LITERAL_LINE_RE = /^\s*\+?database:\s*['"]?lake['"]?\s*(?:#.*)?$/

// The conditional form dbt-runner writes, matched so detection is idempotent.
const CONDITIONAL_LINE_RE =
  /^\s*\+?database:\s*"\{\{\s*'lake'\s+if\s+target\.type\s*==\s*'duckdb'\s+else\s+target\.database\s*\}\}"\s*(?:#.*)?$/

function toLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/)
}

export function isLiteralLakeDatabaseLine(line: string): boolean {
  return LITERAL_LINE_RE.test(line)
}

export function isConditionalLakeDatabaseLine(line: string): boolean {
  return CONDITIONAL_LINE_RE.test(line)
}

/** Whether dbt_project.yml already pins models at the lake, in either form. */
export function hasLakeDatabaseLine(content: string): boolean {
  return toLines(content).some(
    (line) => isLiteralLakeDatabaseLine(line) || isConditionalLakeDatabaseLine(line),
  )
}

/** Whether the file has the literal form, which fails outright on a non-duckdb target. */
export function hasLiteralLakeDatabaseLine(content: string): boolean {
  return toLines(content).some(isLiteralLakeDatabaseLine)
}

/** Whether the file already has the target-conditional form. */
export function hasConditionalLakeDatabaseLine(content: string): boolean {
  return toLines(content).some(isConditionalLakeDatabaseLine)
}
