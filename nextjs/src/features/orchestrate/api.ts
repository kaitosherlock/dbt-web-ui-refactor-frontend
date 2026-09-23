import { apiFetch } from '@/common/api/client'

// --- Schedules ------------------------------------------------------------
// CRUD is Prisma-side (same pattern as ingest sources); the runner only reads
// the rows and fires them.

export type RunCommandName =
  | 'run'
  | 'test'
  | 'build'
  | 'compile'
  | 'docs'
  | 'deps'
  | 'clean'
  | 'seed'
  | 'snapshot'
  | 'source_freshness'

export interface ScheduleRow {
  id: string
  projectId: string
  name: string
  command: RunCommandName
  selector: string | null
  target: string | null
  cron: string
  isActive: boolean
  webhookUrl: string | null
  publishSchema: string | null
  lastRunAt: string | null
  lastRunId: string | null
  lastStatus: string | null
  nextRunAt: string | null
  project?: { id: string; name: string } | null
}

export async function getSchedules(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return apiFetch<ScheduleRow[]>(`/api/schedules${query}`)
}

export async function createSchedule(data: Record<string, unknown>) {
  return apiFetch<ScheduleRow>('/api/schedules', { method: 'POST', body: JSON.stringify(data) })
}

export async function updateSchedule(id: string, data: Record<string, unknown>) {
  return apiFetch<ScheduleRow>('/api/schedules', {
    method: 'PATCH',
    body: JSON.stringify({ id, ...data }),
  })
}

export async function deleteSchedule(id: string) {
  return apiFetch(`/api/schedules?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}
