import { apiFetch } from '@/common/api/client'

// --- Iceberg publish ------------------------------------------------------
// The lake lives in dbt-runner, so publishing goes through the proxy rather than
// Prisma: nothing about it is application state.

export interface IcebergPublishResult {
  success: boolean
  schema: string
  namespace?: string
  warehouse?: string
  /** One entry per table: "full: N file(s)", "incremental: +N file(s)", "unchanged". */
  published: Record<string, string>
}

export async function getIcebergMeta() {
  return apiFetch<{ configured: boolean; lakehouse_configured: boolean }>(
    '/api/dbt-runner/lake/iceberg/meta',
  )
}

export async function publishIceberg(projectId: string, schema: string, tables?: string[]) {
  return apiFetch<IcebergPublishResult>(`/api/dbt-runner/lake/iceberg/${projectId}`, {
    method: 'POST',
    body: JSON.stringify({ schema, ...(tables?.length ? { tables } : {}) }),
  })
}

// --- A project's lakehouse ------------------------------------------------
// Both halves in one call, because they are one decision: a lake attached
// without `+database: lake` is the state where ingest succeeds, the Parquet is
// there, and dbt quietly writes its marts to the warehouse file instead.

export interface ProjectLakehouse {
  connectionId: string | null
  name: string | null
  mode: 'managed' | 'external' | null
  maintained: boolean | null
  buildIntoLake: boolean
  /** Only dbt-duckdb can attach a DuckLake catalog. */
  warehouseSupportsLake: boolean
}

export async function getProjectLakehouse(projectId: string) {
  return apiFetch<ProjectLakehouse>(`/api/dbt-runner/lakehouse/project/${projectId}`)
}

export async function setProjectLakehouse(
  projectId: string,
  data: { connectionId?: string | null; buildIntoLake?: boolean },
) {
  return apiFetch<{ success: boolean; projectFileChanged: boolean }>(
    `/api/dbt-runner/lakehouse/project/${projectId}`,
    { method: 'PUT', body: JSON.stringify(data) },
  )
}

export async function getLakehouseUsage(connectionId: string) {
  return apiFetch<{
    mode: string
    maintained: boolean
    metadataSchema: string
    dataPath: string
    projects: Array<{ id: string; name: string }>
  }>(`/api/dbt-runner/lakehouse/${connectionId}/usage`)
}
