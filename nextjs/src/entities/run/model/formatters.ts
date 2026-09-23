import type { DbtRun } from "../types"

export function getCommandName(command: string): string {
  if (command === "source_freshness") return "source freshness"
  if (command === "run_operation") return "run-operation"
  return command
}

export const COMMAND_LABELS: Record<string, string> = {
  run: "dbt run",
  build: "dbt build",
  test: "dbt test",
  compile: "dbt compile",
  docs: "dbt docs generate",
  deps: "dbt deps",
  clean: "dbt clean",
  seed: "dbt seed",
  snapshot: "dbt snapshot",
  source_freshness: "dbt source freshness",
  parse: "dbt parse",
  ls: "dbt ls",
  debug: "dbt debug",
  run_operation: "dbt run-operation",
  retry: "dbt retry",
  clone: "dbt clone",
}

export function formatCommandLabel(command: string): string {
  return COMMAND_LABELS[command] || `dbt ${getCommandName(command)}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function shortHash(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : "—"
}

export function getFullCommand(run: DbtRun): string {
  // source_freshness is one enum value but two CLI words; run_operation is run-operation.
  const command = getCommandName(run.command)
  return `dbt ${command}${run.selector ? ` --select ${run.selector}` : ""}`
}

/**
 * Format target for display in run details. Runs executed without an explicit
 * --target flag ran on the default target, which is always 'dev'.
 */
export function formatRunTarget(target: string | null | undefined): string {
  if (!target || !target.trim()) return "dev"
  return target.trim()
}
