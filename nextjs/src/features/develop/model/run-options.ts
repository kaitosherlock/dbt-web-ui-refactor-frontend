/**
 * Pure helpers for dbt run options: validation, selectors parsing, and building
 * request payloads for dbt-runner.
 *
 * All flags are sent as structured request fields, NEVER raw CLI text in the
 * command string (the backend refuses conflicting flags).
 */

export interface VarEntry {
  key: string
  value: string
}

export interface RunOptionsState {
  vars?: Record<string, unknown>
  varEntries?: VarEntry[]
  empty?: boolean
  sample?: string
  event_time_start?: string
  event_time_end?: string
  full_refresh?: boolean
  selector_name?: string
  state_target?: string
  defer?: boolean
  favor_state?: boolean
}

export interface DbtRunOptionsPayload {
  vars?: Record<string, unknown>
  empty?: boolean
  sample?: string
  event_time_start?: string
  event_time_end?: string
  full_refresh?: boolean
  selector_name?: string
  state_target?: string
  defer?: boolean
  favor_state?: boolean
}

export const MAX_VARS_BYTES = 16 * 1024 // 16 KiB
export const SAMPLE_PATTERN = /^\s*([1-9][0-9]{0,5})\s+(hour|day|month|year)s?\s*$/i
export const SELECTOR_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
export const TARGET_NAME_PATTERN = /^[a-z][a-z0-9_]{0,29}$/

const EMPTY_COMMANDS = new Set(["run", "build", "compile", "snapshot"])
const SAMPLE_COMMANDS = new Set(["run", "build"])
const EVENT_TIME_COMMANDS = new Set(["run", "build"])
const FULL_REFRESH_COMMANDS = new Set([
  "run",
  "build",
  "clone",
  "compile",
  "retry",
  "seed",
  "show",
])
const SELECTOR_COMMANDS = new Set([
  "run",
  "build",
  "test",
  "seed",
  "snapshot",
  "compile",
  "show",
  "ls",
  "list",
  "clone",
  "docs generate",
  "docs",
  "source freshness",
  "source",
])

/**
 * Coerce a string value to a JSON primitive if valid JSON, otherwise keep as string.
 */
export function coerceVarValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null
  if (/^0\d+$/.test(trimmed)) return value
  if (!Number.isNaN(Number(trimmed)) && !trimmed.startsWith("0x")) {
    const num = Number(trimmed)
    if (Number.isFinite(num)) return num
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}

/**
 * Validate a key/value array or object for `--vars`.
 */
export function validateVars(
  input: VarEntry[] | Record<string, unknown> | undefined | null,
): { valid: boolean; error?: string; vars?: Record<string, unknown> } {
  if (!input) {
    return { valid: true, vars: undefined }
  }

  let obj: Record<string, unknown> = {}
  if (Array.isArray(input)) {
    for (const entry of input) {
      const k = entry.key.trim()
      if (!k && !entry.value.trim()) continue
      if (!k) {
        return { valid: false, error: "Variable key cannot be empty" }
      }
      obj[k] = coerceVarValue(entry.value)
    }
  } else if (typeof input === "object") {
    obj = { ...input }
  } else {
    return { valid: false, error: "vars must be an object of key/value pairs" }
  }

  if (Object.keys(obj).length === 0) {
    return { valid: true, vars: undefined }
  }

  try {
    const encoded = JSON.stringify(obj)
    const bytes = new TextEncoder().encode(encoded).length
    if (bytes > MAX_VARS_BYTES) {
      return {
        valid: false,
        error: `vars size (${bytes} bytes) exceeds maximum limit of 16 KiB`,
      }
    }
    return { valid: true, vars: obj }
  } catch (err) {
    return {
      valid: false,
      error: `vars must be JSON serializable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Validate `--sample` spec ("<count> <grain>").
 */
export function validateSample(
  sample?: string | null,
): { valid: boolean; error?: string; normalized?: string } {
  if (!sample || !sample.trim()) {
    return { valid: true, normalized: undefined }
  }
  const trimmed = sample.trim()
  if (trimmed.length > 32) {
    return { valid: false, error: "sample must be 32 characters or fewer" }
  }
  const match = trimmed.match(SAMPLE_PATTERN)
  if (!match) {
    return {
      valid: false,
      error: "sample must look like '<count> <grain>', grain one of hour, day, month, year (e.g. '3 days')",
    }
  }
  const count = parseInt(match[1], 10)
  const baseGrain = match[2].toLowerCase()
  const grain = count === 1 ? baseGrain : `${baseGrain}s`
  return { valid: true, normalized: `${count} ${grain}` }
}

/**
 * Validate `--event-time-start` and `--event-time-end` for microbatch models.
 */
export function validateEventTime(
  start?: string | null,
  end?: string | null,
): { valid: boolean; error?: string; startIso?: string; endIso?: string } {
  const hasStart = Boolean(start && start.trim())
  const hasEnd = Boolean(end && end.trim())

  if (!hasStart && !hasEnd) {
    return { valid: true }
  }
  if (hasStart !== hasEnd) {
    return {
      valid: false,
      error: "event_time_start and event_time_end must be given together",
    }
  }

  const startDate = new Date(start!.trim())
  const endDate = new Date(end!.trim())

  if (Number.isNaN(startDate.getTime())) {
    return { valid: false, error: "event_time_start must be a valid ISO 8601 datetime" }
  }
  if (Number.isNaN(endDate.getTime())) {
    return { valid: false, error: "event_time_end must be a valid ISO 8601 datetime" }
  }
  if (startDate.getTime() >= endDate.getTime()) {
    return { valid: false, error: "event_time_start must be before event_time_end" }
  }

  return {
    valid: true,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
  }
}

/**
 * Validate `--selector` name.
 */
export function validateSelectorName(
  name?: string | null,
): { valid: boolean; error?: string } {
  if (!name || !name.trim()) {
    return { valid: true }
  }
  const trimmed = name.trim()
  if (!SELECTOR_NAME_PATTERN.test(trimmed)) {
    return { valid: false, error: `Invalid selector name '${trimmed}'` }
  }
  return { valid: true }
}

/**
 * Parse selectors defined in selectors.yml.
 */
export function parseSelectors(content: string): string[] {
  if (!content || !content.trim()) return []
  const names: string[] = []
  const lines = content.split(/\r?\n/)
  let inSelectors = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    if (/^selectors\s*:/.test(trimmed)) {
      inSelectors = true
      continue
    }

    if (inSelectors) {
      // Top-level key unindented: exit selectors block
      if (/^[a-zA-Z0-9_-]+\s*:/.test(line) && !line.startsWith(" ") && !line.startsWith("\t")) {
        break
      }
      const match = trimmed.match(/^-\s*name\s*:\s*['"]?([A-Za-z0-9_.-]+)['"]?/) ||
                    trimmed.match(/^name\s*:\s*['"]?([A-Za-z0-9_.-]+)['"]?/)
      if (match && match[1]) {
        if (!names.includes(match[1])) {
          names.push(match[1])
        }
      }
    }
  }
  return names
}

/**
 * Extract root command name from command line string ("run --select ... " -> "run").
 */
export function extractDbtCommandName(command: string): string {
  const parts = command.trim().split(/\s+/)
  if (!parts[0]) return "run"
  if (parts[0] === "dbt") return parts[1] || "run"
  return parts[0]
}

/**
 * Build request fields for dbt-runner according to the targeted command.
 */
export function buildRunOptionsPayload(
  options: RunOptionsState,
  command?: string,
): DbtRunOptionsPayload {
  const payload: DbtRunOptionsPayload = {}
  const cmdName = command ? extractDbtCommandName(command) : undefined

  // Vars
  if (options.varEntries && options.varEntries.length > 0) {
    const varsResult = validateVars(options.varEntries)
    if (varsResult.vars) payload.vars = varsResult.vars
  } else if (options.vars && Object.keys(options.vars).length > 0) {
    payload.vars = options.vars
  }

  // Empty
  if (options.empty && (!cmdName || EMPTY_COMMANDS.has(cmdName))) {
    payload.empty = true
  }

  // Sample
  if (options.sample && (!cmdName || SAMPLE_COMMANDS.has(cmdName))) {
    const sampleResult = validateSample(options.sample)
    if (sampleResult.normalized) payload.sample = sampleResult.normalized
  }

  // Event times
  if (options.event_time_start && options.event_time_end && (!cmdName || EVENT_TIME_COMMANDS.has(cmdName))) {
    const eventTimeResult = validateEventTime(options.event_time_start, options.event_time_end)
    if (eventTimeResult.startIso && eventTimeResult.endIso) {
      payload.event_time_start = eventTimeResult.startIso
      payload.event_time_end = eventTimeResult.endIso
    }
  }

  // Full refresh
  if (options.full_refresh && (!cmdName || FULL_REFRESH_COMMANDS.has(cmdName))) {
    payload.full_refresh = true
  }

  // Selector
  if (options.selector_name && (!cmdName || SELECTOR_COMMANDS.has(cmdName))) {
    payload.selector_name = options.selector_name.trim()
  }

  // State target & Defer
  if (options.state_target && options.state_target.trim()) {
    payload.state_target = options.state_target.trim()
    if (options.defer) {
      payload.defer = true
      if (options.favor_state) {
        payload.favor_state = true
      }
    }
  }

  return payload
}

/**
 * Check if any run option is currently configured / active.
 */
export function hasActiveRunOptions(options: RunOptionsState): boolean {
  if (options.full_refresh) return true
  if (options.empty) return true
  if (options.sample && options.sample.trim()) return true
  if (options.event_time_start && options.event_time_end) return true
  if (options.selector_name && options.selector_name.trim()) return true
  if (options.state_target && options.defer) return true
  if (options.vars && Object.keys(options.vars).length > 0) return true
  if (options.varEntries && options.varEntries.some((e) => e.key.trim() && e.value.trim())) return true
  return false
}

// Local storage keys
export const getRunOptionsStorageKey = (projectId: string, userId: string) =>
  `dbt-run-options:${userId}:${projectId}`

export function loadRunOptions(projectId: string, userId: string): RunOptionsState {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(getRunOptionsStorageKey(projectId, userId))
    if (!raw) return {}
    return JSON.parse(raw) as RunOptionsState
  } catch {
    return {}
  }
}

export function saveRunOptions(
  projectId: string,
  userId: string,
  options: RunOptionsState,
): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(getRunOptionsStorageKey(projectId, userId), JSON.stringify(options))
  } catch {
    // Ignore storage quota errors
  }
}

export interface StateTargetResolution {
  candidateTargets: string[]
  selectedTarget: string
  hasState: boolean
}

/**
 * Resolve state targets for state & defer options.
 * The server never saves state for 'dev' (only non-dev targets and schedules).
 * Lists the project's non-dev targets (from targets API) plus any target that
 * GET /dbt/state reports, defaulting to the first target with state artifacts.
 */
export function resolveStateTargets({
  availableTargets,
  stateTargets,
  currentTarget,
}: {
  availableTargets: string[]
  stateTargets: Array<{ target: string; manifest?: boolean }>
  currentTarget?: string | null
}): StateTargetResolution {
  const nonDevAvailable = (availableTargets || []).filter((t) => t && t !== "dev")
  const fromStateApi = (stateTargets || []).map((s) => s.target).filter((t) => t && t !== "dev")
  const candidateTargets = Array.from(new Set([...nonDevAvailable, ...fromStateApi]))

  const targetsWithState = new Set(
    (stateTargets || []).filter((s) => s.manifest && s.target !== "dev").map((s) => s.target),
  )

  const firstWithState = candidateTargets.find((t) => targetsWithState.has(t)) || candidateTargets[0] || ""

  let selectedTarget = firstWithState
  if (currentTarget && currentTarget !== "dev" && candidateTargets.includes(currentTarget)) {
    selectedTarget = currentTarget
  }

  const hasState = Boolean(selectedTarget && targetsWithState.has(selectedTarget))

  return {
    candidateTargets,
    selectedTarget,
    hasState,
  }
}
