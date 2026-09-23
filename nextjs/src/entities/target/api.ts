import { apiFetch } from '@/common/api/client'
import type { ProjectTargetRow } from './types'

/**
 * A project's extra named targets (dev is always the project's own
 * connection — see CLAUDE.md "Targets"). Shared by the Projects feature
 * (managing them) and the Orchestrate feature (a schedule picks one to run
 * against).
 */
export async function getProjectTargets(projectId: string) {
  return apiFetch<ProjectTargetRow[]>(`/api/targets?projectId=${encodeURIComponent(projectId)}`)
}

export async function createProjectTarget(data: Record<string, unknown>) {
  return apiFetch<ProjectTargetRow>('/api/targets', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateProjectTarget(data: Record<string, unknown> & { id: string }) {
  return apiFetch<ProjectTargetRow>('/api/targets', { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteProjectTarget(id: string) {
  return apiFetch(`/api/targets?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}
