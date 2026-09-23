/**
 * Pure helper functions for dbt resource listing (dbt ls)
 */

export interface DbtLsResourceConfig {
  materialized?: string
  enabled?: boolean
  schema?: string
  database?: string
}

export interface DbtLsResourceRow {
  unique_id: string
  name: string
  resource_type: string
  package_name?: string
  original_file_path?: string
  alias?: string
  source_name?: string
  tags?: string[]
  depends_on?: {
    macros?: string[]
    nodes?: string[]
  } | string[]
  config?: DbtLsResourceConfig
}

export const COMMON_RESOURCE_TYPES = [
  "all",
  "model",
  "source",
  "seed",
  "snapshot",
  "test",
  "unit_test",
  "exposure",
  "metric",
  "semantic_model",
  "saved_query",
  "analysis",
] as const

export function filterResources(
  rows: DbtLsResourceRow[],
  filterQuery: string = "",
  resourceType: string = "all"
): DbtLsResourceRow[] {
  const query = filterQuery.trim().toLowerCase()
  const matchType = resourceType && resourceType !== "all" ? resourceType.toLowerCase() : null

  return rows.filter((row) => {
    if (matchType && row.resource_type.toLowerCase() !== matchType) {
      return false
    }
    if (!query) {
      return true
    }
    const nameMatch = row.name.toLowerCase().includes(query)
    const idMatch = row.unique_id.toLowerCase().includes(query)
    const pathMatch = row.original_file_path ? row.original_file_path.toLowerCase().includes(query) : false
    const packageMatch = row.package_name ? row.package_name.toLowerCase().includes(query) : false
    const tagMatch = Array.isArray(row.tags) && row.tags.some((t) => t.toLowerCase().includes(query))
    const schemaMatch = row.config?.schema ? row.config.schema.toLowerCase().includes(query) : false

    return nameMatch || idMatch || pathMatch || packageMatch || tagMatch || schemaMatch
  })
}

export function countByResourceType(rows: DbtLsResourceRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const type = row.resource_type || "other"
    counts[type] = (counts[type] || 0) + 1
  }
  return counts
}

export function formatResourceSummary(rows: DbtLsResourceRow[]): string {
  const counts = countByResourceType(rows)
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`)
  return parts.join(", ")
}
