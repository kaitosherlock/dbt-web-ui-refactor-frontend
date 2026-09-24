/**
 * Pure model helpers for dbt lineage graphs (table-level and column-level).
 */

export interface ColumnLineageSource {
  column: string;
  table: string;
  expression?: string;
}

export type ColumnLineageMap = Record<string, ColumnLineageSource[]>;

export interface NormalizedColumnLineage {
  columnLineage: ColumnLineageMap;
  columnLineageError: string | null;
}

/**
 * Normalise raw column lineage from dbt-runner API responses.
 *
 * Tolerant of:
 * - Legacy error shape: `column_lineage = { error: "..." }`
 * - New backend error field: `column_lineage_error = "..."`
 * - Non-array column entries (discarded instead of crashing on .map)
 * - Missing / null / invalid payloads
 */
export function normalizeColumnLineage(
  rawColumnLineage: unknown,
  rawColumnLineageError?: unknown,
): NormalizedColumnLineage {
  let error: string | null = null;

  if (typeof rawColumnLineageError === "string" && rawColumnLineageError.trim()) {
    error = rawColumnLineageError.trim();
  }

  const columnLineage: ColumnLineageMap = {};

  if (rawColumnLineage && typeof rawColumnLineage === "object" && !Array.isArray(rawColumnLineage)) {
    for (const [key, value] of Object.entries(rawColumnLineage)) {
      if (key === "error" && typeof value === "string" && value.trim()) {
        if (!error) {
          error = value.trim();
        }
        continue;
      }
      if (Array.isArray(value)) {
        columnLineage[key] = value.filter(
          (item): item is ColumnLineageSource =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof (item as { column?: unknown }).column === "string" &&
                typeof (item as { table?: unknown }).table === "string",
            ),
        );
      }
    }
  } else if (typeof rawColumnLineage === "string" && rawColumnLineage.trim() && !error) {
    error = rawColumnLineage.trim();
  }

  return {
    columnLineage,
    columnLineageError: error,
  };
}
