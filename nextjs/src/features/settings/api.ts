import { apiFetch } from '@/common/api/client'

export interface SystemInfo {
  version: string
  auth: { mode: "oidc" | "disabled"; issuer_configured: boolean }
  runs: {
    max_concurrent: number
    per_project_concurrent: number
    subprocess_timeout_seconds: number
    history_retention_days: number
  }
  scheduler: {
    enabled: boolean
    running: boolean
    leader: boolean
    tick_seconds: number
    misfire_grace_seconds: number
  }
  worker: { warm_pool_enabled: boolean; warm_pool_size: number }
  lakehouse: {
    configured: boolean
    snapshot_retention_days: number
    maintenance_interval_hours: number
    inline_row_limit: number
  }
  ingest: { allow_private_hosts: boolean; subprocess_timeout_seconds: number }
  adapters: string[]
}

/** Deployment settings that otherwise only exist as environment variables. */
export async function getSystemInfo() {
  return apiFetch<SystemInfo>('/api/dbt-runner/system/info')
}
