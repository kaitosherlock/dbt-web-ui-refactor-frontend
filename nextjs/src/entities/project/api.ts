import { apiFetch } from '@/common/api/client'

// The UI was written against Supabase's snake_case column names, but Prisma
// returns camelCase. Map project rows back to snake_case so pages keep working.
/* eslint-disable @typescript-eslint/no-explicit-any */
function toSnakeProject(p: any): any {
  if (!p || typeof p !== 'object') return p
  return {
    ...p,
    git_url: p.gitUrl ?? null,
    git_branch: p.gitBranch ?? null,
    git_project_subdirectory: p.gitProjectSubdirectory ?? null,
    staging_dir: p.stagingDir ?? null,
    marts_dir: p.martsDir ?? null,
    sync_status: p.syncStatus ?? null,
    dremio_source_id: p.dremioSourceId ?? null,
    connection_id: p.connectionId ?? null,
    deleted_at: p.deletedAt ?? null,
    created_at: p.createdAt ?? null,
    updated_at: p.updatedAt ?? null,
    created_by: p.createdBy ?? null,
  }
}

export async function getProjects(includeDeleted = false) {
  const rows = await apiFetch<any[]>(`/api/projects?includeDeleted=${includeDeleted}`)
  return (rows || []).map(toSnakeProject)
}

export async function getProjectById(id: string) {
  const row = await apiFetch<any>(`/api/projects?id=${id}`)
  return toSnakeProject(row)
}

export async function createProject(data: Record<string, unknown>) {
  return apiFetch<any>('/api/projects', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateProject(id: string, data: Record<string, unknown>) {
  return apiFetch<any>(`/api/projects?id=${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export async function softDeleteProject(id: string) {
  return apiFetch<any>(`/api/projects?id=${id}&hard=false`, { method: 'DELETE' })
}

export async function hardDeleteProject(id: string) {
  return apiFetch<any>(`/api/projects?id=${id}&hard=true`, { method: 'DELETE' })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
