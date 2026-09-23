export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

export const DBT_PROFILE_SECRET_PREFIX = 'DBT_ENV_SECRET_DBT_CRAFT_'
export const DBT_LAKE_CATALOG_PASSWORD_ENV = 'DBT_ENV_SECRET_LAKE_CATALOG_PASSWORD'

const LEGACY_DBT_CLI_FLAGS = [
  'DBT_ARTIFACT_STATE_PATH',
  'DBT_CACHE_SELECTED_ONLY',
  'DBT_CLEAN_PROJECT_FILES_ONLY',
  'DBT_DEBUG',
  'DBT_DEFER',
  'DBT_DEFER_STATE',
  'DBT_DEFER_TO_STATE',
  'DBT_EMPTY',
  'DBT_EVENT_TIME_END',
  'DBT_EVENT_TIME_START',
  'DBT_EXCLUDE_RESOURCE_TYPES',
  'DBT_EXPORT_SAVED_QUERIES',
  'DBT_FAIL_FAST',
  'DBT_FAVOR_STATE',
  'DBT_FAVOR_STATE_MODE',
  'DBT_FULL_REFRESH',
  'DBT_HOST',
  'DBT_INCLUDE_SAVED_QUERY',
  'DBT_INDIRECT_SELECTION',
  'DBT_INTROSPECT',
  'DBT_LOG_CACHE_EVENTS',
  'DBT_LOG_FILE_MAX_BYTES',
  'DBT_LOG_FORMAT',
  'DBT_LOG_FORMAT_FILE',
  'DBT_LOG_LEVEL',
  'DBT_LOG_LEVEL_FILE',
  'DBT_LOG_PATH',
  'DBT_MACRO_DEBUGGING',
  'DBT_NO_PRINT',
  'DBT_PACKAGES_INSTALL_PATH',
  'DBT_PARTIAL_PARSE',
  'DBT_PARTIAL_PARSE_FILE_DIFF',
  'DBT_PARTIAL_PARSE_FILE_PATH',
  'DBT_POPULATE_CACHE',
  'DBT_PRINT',
  'DBT_PRINTER_WIDTH',
  'DBT_PROFILE',
  'DBT_PROFILES_DIR',
  'DBT_PROJECT_DIR',
  'DBT_QUIET',
  'DBT_RESOURCE_TYPES',
  'DBT_SAMPLE',
  'DBT_SEND_ANONYMOUS_USAGE_STATS',
  'DBT_SHOW_RESOURCE_REPORT',
  'DBT_SINGLE_THREADED',
  'DBT_STATE',
  'DBT_STATIC_PARSER',
  'DBT_STORE_FAILURES',
  'DBT_TARGET',
  'DBT_TARGET_PATH',
  'DBT_UPLOAD_TO_ARTIFACTS_INGEST_API',
  'DBT_USE_COLORS',
  'DBT_USE_COLORS_FILE',
  'DBT_USE_EXPERIMENTAL_PARSER',
  'DBT_USE_FAST_TEST_EDGES',
  'DBT_VERSION_CHECK',
  'DBT_WARN_ERROR',
  'DBT_WARN_ERROR_OPTIONS',
  'DBT_WRITE_JSON',
]

export const FORBIDDEN_DBT_CLI_ENV_VARS = new Set<string>([
  ...LEGACY_DBT_CLI_FLAGS,
  'DBT_ENGINE_SQLPARSE',
  ...LEGACY_DBT_CLI_FLAGS.map((name) => `DBT_ENGINE_${name.replace(/^DBT_/, '')}`),
])

export function getForbiddenEnvVarReason(name: string): string | null {
  const normalized = name.toUpperCase()
  if (FORBIDDEN_DBT_CLI_ENV_VARS.has(normalized)) {
    return 'dbt treats it as a CLI option'
  }
  if (['PATH', 'HOME', 'VIRTUAL_ENV'].includes(normalized)) {
    return 'it controls the dbt process environment'
  }
  if (
    normalized.startsWith('PYTHON') ||
    normalized.startsWith('LD_') ||
    normalized.startsWith('DYLD_') ||
    normalized.startsWith('UV_')
  ) {
    return 'it controls Python or native code loading'
  }
  if (
    normalized.startsWith(DBT_PROFILE_SECRET_PREFIX) ||
    normalized === DBT_LAKE_CATALOG_PASSWORD_ENV
  ) {
    return 'it is reserved for a server-managed credential'
  }
  return null
}

export interface EnvVarValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validates an environment variable name against format rules and dbt-runner restrictions.
 */
export function validateEnvVarName(name: string): EnvVarValidationResult {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Environment variable name cannot be empty' }
  }
  if (!ENV_NAME_RE.test(name)) {
    return { valid: false, error: `Invalid environment variable name: ${name}` }
  }
  const reason = getForbiddenEnvVarReason(name)
  if (reason) {
    return {
      valid: false,
      error: `Environment variable '${name}' is not allowed because ${reason}`,
    }
  }
  return { valid: true }
}
