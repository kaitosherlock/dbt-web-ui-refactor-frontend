import { apiFetch } from '@/common/api/client'

/**
 * Read-only connection access shared across features: home's dashboard, the
 * project target picker (features/projects), an ingest source's connection
 * picker (features/ingest). Creating, editing, deleting and testing a
 * connection is the Connections feature's own job — see
 * features/connections/api.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getConnections() {
  return apiFetch<any[]>('/api/connections')
}
/* eslint-enable @typescript-eslint/no-explicit-any */
