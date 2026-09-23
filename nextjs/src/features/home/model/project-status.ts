export type ProjectStatusKey = 'synced' | 'syncing' | 'error' | 'pending'

export interface ProjectWithRunStatus {
  sync_status?: string | null
  runs?: Array<{
    status?: string | null
    command?: string | null
  }> | null
}

/**
 * Resolves the operational status of a project for the Home dashboard.
 * If the latest build/run succeeded, the project shows as ready ("synced").
 * If the latest build/run failed, it shows as needs attention ("error").
 * If the latest build/run is currently running, it shows as syncing/running ("syncing").
 * If there are no runs, it falls back to git sync status ("synced", "error", "syncing", or "pending").
 */
export function resolveProjectStatus(project: ProjectWithRunStatus): ProjectStatusKey {
  const latestRun = project.runs?.[0]
  if (latestRun?.status) {
    const s = latestRun.status.toLowerCase()
    if (s === 'success') return 'synced'
    if (s === 'error' || s === 'failed') return 'error'
    if (s === 'running') return 'syncing'
  }

  const sync = (project.sync_status || '').toLowerCase()
  if (sync === 'synced') return 'synced'
  if (sync === 'error') return 'error'
  if (sync === 'syncing') return 'syncing'

  return 'pending'
}
