import { apiFetch, apiClient } from '@/common/api/client'

/**
 * Test a not-yet-saved connection's config directly against dbt-runner. Used
 * while filling in the form, before the row exists — once saved,
 * `testConnectionById` below tests the persisted row instead.
 */
export interface ConnectionTestRequest {
  type: string
  name: string
  config: Record<string, unknown>
}

export interface ConnectionTestResponse {
  success: boolean
  message: string
  details?: string
}

export async function testConnection(request: ConnectionTestRequest): Promise<ConnectionTestResponse> {
  return apiClient.post<ConnectionTestResponse>('/connection/test', request)
}

export const connectionApi = {
  test: testConnection,
}

// --- Connections / Dremio sources (CRUD + test-by-id) ----------------------
// Reading the list is entities/connection's job (shared by other features'
// pickers); creating, editing, deleting and testing a saved connection is
// this feature's own.

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function createConnection(data: Record<string, unknown>) {
  return apiFetch<any>('/api/connections', { method: 'POST', body: JSON.stringify(data) })
}

export async function deleteConnection(id: string, type?: 'dremio' | 'connection') {
  const qs = type ? `?id=${id}&type=${type}` : `?id=${id}`
  return apiFetch<any>(`/api/connections${qs}`, { method: 'DELETE' })
}

export async function updateConnection(
  id: string,
  type: 'dremio' | 'connection',
  data: Record<string, unknown>
) {
  return apiFetch<any>(`/api/connections?id=${id}&type=${type}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function testConnectionById(id: string, type: 'dremio' | 'connection') {
  return apiFetch<{ success: boolean; message: string }>(
    `/api/connections/${id}/test?type=${type}`,
    { method: 'POST' }
  )
}

export interface ConnectionUsage {
  in_use: boolean
  blocked: boolean
  project_count: number
  projects: Array<{ id: string; name: string }>
  ingest_source_count: number
  ingest_sources: Array<{ id: string; name: string; dataset: string; project_name: string }>
}

/** What still depends on a connection, asked before offering to delete it. */
export async function getConnectionUsage(connectionId: string) {
  return apiFetch<ConnectionUsage>(`/api/dbt-runner/connection/usage/${connectionId}`)
}
