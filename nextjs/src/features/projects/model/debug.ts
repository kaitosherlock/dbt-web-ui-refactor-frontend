/**
 * Pure helper functions for dbt debug output and target testing
 */

export interface DbtDebugResult {
  success: boolean
  target: string
  output: string
}

export interface DebugSummary {
  passes: number
  warnings: number
  errors: number
  statusText: string
}

export function parseDebugSummary(output: string): DebugSummary {
  let passes = 0
  let warnings = 0
  let errors = 0

  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.includes("[OK") || trimmed.includes("OK found") || trimmed.includes("OK connection ok")) {
      passes++
    }
    if (trimmed.includes("[WARN") || trimmed.includes("WARNING")) {
      warnings++
    }
    if (trimmed.includes("[ERROR") || trimmed.includes("ERROR") || trimmed.includes("Connection test: [FAIL]")) {
      errors++
    }
  }

  let statusText = "Ready"
  if (errors > 0) {
    statusText = `${errors} error${errors === 1 ? "" : "s"} detected`
  } else if (warnings > 0) {
    statusText = `Passed with ${warnings} warning${warnings === 1 ? "" : "s"}`
  } else if (passes > 0) {
    statusText = "All checks passed"
  }

  return {
    passes,
    warnings,
    errors,
    statusText,
  }
}

export function formatTargetLabel(target?: string): string {
  const trimmed = target?.trim()
  return trimmed || "dev"
}
