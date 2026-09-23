export const SNOWFLAKE_DOMAIN = 'snowflakecomputing.com'

const ACCOUNT_RE =
  /^[a-z0-9](?:[a-z0-9_-]{0,253}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,3}$/

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const WORKSPACE_HOST_RE = new RegExp(
  `^(?:${HOST_LABEL}\\.)+(?:cloud\\.databricks\\.com|azuredatabricks\\.net|gcp\\.databricks\\.com)$`,
)
const WAREHOUSE_PATH_RE = /^\/sql\/1\.0\/warehouses\/[a-z0-9]{16}$/
const CLUSTER_PATH_RE =
  /^\/sql\/protocolv1\/o\/[0-9]+\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/

export class ConnectionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionValidationError'
  }
}

/**
 * Validate an account identifier and return it in the form used in a host.
 * Underscores become hyphens, as dbt-snowflake does itself.
 */
export function normalizeSnowflakeAccount(account: unknown): string {
  const value = String(account ?? '').trim().toLowerCase()
  if (!value) {
    throw new ConnectionValidationError(
      'A Snowflake connection needs an account identifier, for example myorg-myaccount',
    )
  }
  if (value.includes(SNOWFLAKE_DOMAIN) || /[:/@]/.test(value)) {
    throw new ConnectionValidationError(
      `Give only the account identifier, not a URL or host name. '${SNOWFLAKE_DOMAIN}' and ':@/' are not part of an account.`,
    )
  }
  if (!ACCOUNT_RE.test(value)) {
    throw new ConnectionValidationError(
      `'${value}' is not a valid Snowflake account identifier. Expected 'orgname-accountname' or an account locator.`,
    )
  }
  return value.replace(/_/g, '-')
}

/**
 * Derive the full Snowflake host name from an account identifier.
 */
export function snowflakeAccountHost(account: unknown): string {
  return `${normalizeSnowflakeAccount(account)}.${SNOWFLAKE_DOMAIN}`
}

/**
 * Validate and normalize a Databricks workspace hostname (never a URL).
 */
export function normalizeDatabricksHost(host: unknown): string {
  const value = String(host ?? '').trim().toLowerCase()
  if (!value) {
    throw new ConnectionValidationError(
      'A Databricks connection needs a workspace hostname, for example dbc-a1b2c3d4-e5f6.cloud.databricks.com',
    )
  }
  if (value.length > 253 || !WORKSPACE_HOST_RE.test(value)) {
    throw new ConnectionValidationError(
      'Give only a Databricks workspace hostname ending in .cloud.databricks.com, .azuredatabricks.net, or .gcp.databricks.com (no scheme, port, path, or query)',
    )
  }
  return value
}

/**
 * Validate a SQL warehouse or all-purpose cluster HTTP path.
 */
export function normalizeDatabricksHttpPath(httpPath: unknown): string {
  const value = String(httpPath ?? '').trim()
  if (!value || (!WAREHOUSE_PATH_RE.test(value) && !CLUSTER_PATH_RE.test(value))) {
    throw new ConnectionValidationError(
      'Give a Databricks HTTP path shaped like /sql/1.0/warehouses/<16-character-id> or /sql/protocolv1/o/<workspace-id>/<cluster-id>',
    )
  }
  return value
}

/**
 * Validate and normalize a required warehouse schema name (Snowflake, Databricks).
 */
export function normalizeWarehouseSchema(schema: unknown, warehouse: string): string {
  const value = String(schema ?? '').trim()
  if (!value) {
    throw new ConnectionValidationError(
      `A ${warehouse} connection needs a schema, for example 'PUBLIC' or 'analytics'`,
    )
  }
  return value
}

/**
 * Determine whether secret fields can keep the existing stored secret or are required.
 * When editing a connection, the "leave blank to keep existing" behavior is only valid
 * if the selected auth type matches the auth type currently stored.
 */
export function getSecretFieldState({
  isEdit,
  storedAuthType,
  selectedAuthType,
}: {
  isEdit: boolean
  storedAuthType?: string | null
  selectedAuthType: string
}): {
  canKeepExisting: boolean
  isRequired: boolean
} {
  const canKeepExisting = Boolean(isEdit && storedAuthType && storedAuthType === selectedAuthType)
  return {
    canKeepExisting,
    isRequired: !canKeepExisting,
  }
}
