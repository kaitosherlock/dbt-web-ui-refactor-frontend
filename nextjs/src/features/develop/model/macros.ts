/**
 * Pure helper functions for dbt macros and run-operation arguments
 */

export interface DbtMacroArgument {
  name: string
  default?: unknown
}

export interface DbtMacro {
  unique_id: string
  name: string
  package_name?: string | null
  description?: string | null
  arguments?: unknown[]
  signature?: DbtMacroArgument[]
}

const MACRO_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/

export function isValidMacroName(name: string): boolean {
  return MACRO_NAME_REGEX.test(name.trim())
}

export function filterMacros(
  macros: DbtMacro[],
  query: string = "",
  selectedPackage?: string
): DbtMacro[] {
  const q = query.trim().toLowerCase()
  const pkgFilter = selectedPackage && selectedPackage !== "all" ? selectedPackage.toLowerCase() : null

  return macros.filter((m) => {
    if (pkgFilter && (m.package_name || "").toLowerCase() !== pkgFilter) {
      return false
    }
    if (!q) {
      return true
    }
    const nameMatch = m.name.toLowerCase().includes(q)
    const pkgMatch = m.package_name ? m.package_name.toLowerCase().includes(q) : false
    const descMatch = m.description ? m.description.toLowerCase().includes(q) : false
    return nameMatch || pkgMatch || descMatch
  })
}

/**
 * Coerces a user input string into an appropriate JSON-compatible value
 * (boolean, number, parsed JSON object/array, null, or string).
 */
export function parseMacroArgValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null

  // Check if it's a number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed)
    if (!Number.isNaN(num)) return num
  }

  // Check if it's valid JSON (object or array)
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // Fallback to string if JSON parse fails
    }
  }

  return raw
}

/**
 * Converts form field inputs into a structured args record for POST /dbt/run-operation.
 */
export function buildMacroArgsPayload(
  formValues: Record<string, string>,
  signature: DbtMacroArgument[] = []
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(formValues)) {
    if (rawValue === undefined || rawValue === "") {
      continue
    }
    const parsed = parseMacroArgValue(rawValue)
    if (parsed !== undefined) {
      result[key] = parsed
    }
  }

  // Ensure known arguments from signature that have user inputs are included
  for (const arg of signature) {
    if (formValues[arg.name] !== undefined && formValues[arg.name] !== "") {
      const parsed = parseMacroArgValue(formValues[arg.name])
      if (parsed !== undefined) {
        result[arg.name] = parsed
      }
    }
  }

  return result
}
