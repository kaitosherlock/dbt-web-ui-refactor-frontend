import { apiFetch } from '@/common/api/client'

// --- Ingest sources -------------------------------------------------------
// CRUD goes to the Next.js route (Prisma owns writes, as with connections);
// running a load goes to dbt-runner through the /api/dbt-runner proxy.

export interface IngestSourceRow {
  id: string
  projectId: string
  sourceConnectionId: string
  name: string
  dataset: string
  tables: string[]
  destination: 'connection' | 'ducklake'
  writeDisposition: string
  primaryKey?: string[] | null
  partitionBy?: string[] | null
  sourceConnection?: { id: string; name: string; connectionType: string } | null
}

export async function getIngestSources(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return apiFetch<IngestSourceRow[]>(`/api/ingest${query}`)
}

export async function createIngestSource(data: Record<string, unknown>) {
  return apiFetch('/api/ingest', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateIngestSource(id: string, data: Record<string, unknown>) {
  return apiFetch('/api/ingest', { method: 'PATCH', body: JSON.stringify({ id, ...data }) })
}

export async function deleteIngestSource(id: string) {
  return apiFetch(`/api/ingest?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getIngestMeta() {
  return apiFetch<{
    source_connection_types: string[]
    destinations: string[]
    write_dispositions: string[]
    lakehouse_configured: boolean
    file_roots?: string[]
  }>('/api/dbt-runner/ingest/meta')
}

export async function getIngestConnectionTables(connectionId: string) {
  return apiFetch<{ success: boolean; tables: string[]; message?: string }>(
    `/api/dbt-runner/ingest/connections/${connectionId}/tables`,
  )
}

export interface RestProbeResult {
  success: boolean
  url?: string
  status?: number
  record_count?: number
  data_selector?: string
  fields?: string[]
  message?: string
}

/** Fetch one REST endpoint through dbt-runner, to check it before saving. */
export async function probeRestEndpoint(body: {
  connectionId?: string | null
  baseUrl?: string
  path?: string
}) {
  return apiFetch<RestProbeResult>('/api/dbt-runner/ingest/rest/probe', {
    method: 'POST',
    body: JSON.stringify({
      connection_id: body.connectionId || null,
      base_url: body.baseUrl || null,
      path: body.path ?? '',
    }),
  })
}

export async function getIngestDbtSources(sourceId: string) {
  return apiFetch<{ success: boolean; dataset: string; content: string }>(
    `/api/dbt-runner/ingest/sources/${sourceId}/dbt-sources`,
  )
}

export async function cancelIngest(sourceId: string) {
  return apiFetch(`/api/dbt-runner/ingest/sources/${sourceId}/cancel`, { method: 'POST' })
}

export interface IngestRunRow {
  id: string
  status: string
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  rows_loaded: number | null
  tables: Record<string, unknown> | null
  error_message: string | null
}

export async function getIngestRuns(sourceId: string, limit = 25) {
  return apiFetch<{ items: IngestRunRow[] }>(
    `/api/dbt-runner/ingest/sources/${sourceId}/runs?limit=${limit}`,
  )
}

export async function getIngestRunLogs(runId: string) {
  return apiFetch<{ id: string; status: string; logs: string }>(
    `/api/dbt-runner/ingest/runs/${runId}/logs`,
  )
}
