export interface ConnectionRowInput {
  name: string
  connectionType: string
  host: string
  port: number
  database: string
  username: string
  extraConfig?: unknown
}

export interface ConnectionSecretsInput {
  password?: string | null
  secondarySecret?: string | null
  secondary_secret?: string | null
}

export interface ConnectionTestPayload {
  type: string
  name: string
  config: Record<string, unknown>
}

/**
 * Pure helper to map a Connection row and its decrypted secret(s) to the payload
 * expected by dbt-runner's POST /connection/test.
 */
export function buildConnectionTestPayload(
  row: ConnectionRowInput,
  secrets: ConnectionSecretsInput = {},
): ConnectionTestPayload {
  const extraConfig = ((row.extraConfig as Record<string, unknown> | null) ?? {})
  const password = secrets.password ?? ''
  const secondarySecret = secrets.secondarySecret ?? secrets.secondary_secret ?? ''

  if (row.connectionType === 'snowflake') {
    const authType = extraConfig.auth_type === 'keypair' ? 'keypair' : 'password'
    const config: Record<string, unknown> = {
      account: (extraConfig.account as string) || '',
      user: row.username,
      auth_type: authType,
      database: row.database,
      schema: (extraConfig.schema as string) || '',
    }
    if (authType === 'password') {
      config.password = password
    } else {
      config.private_key = password
      if (secondarySecret) {
        config.private_key_passphrase = secondarySecret
      }
    }
    if (extraConfig.role) config.role = extraConfig.role
    if (extraConfig.warehouse) config.warehouse = extraConfig.warehouse

    const profileKeys = [
      'query_tag',
      'client_session_keep_alive',
      'connect_retries',
      'connect_timeout',
      'retry_on_database_errors',
      'retry_all',
      'reuse_connections',
    ] as const
    for (const key of profileKeys) {
      if (extraConfig[key] !== undefined) {
        config[key] = extraConfig[key]
      }
    }

    return { type: 'snowflake', name: row.name, config }
  }

  if (row.connectionType === 'databricks') {
    const authType = extraConfig.auth_type === 'oauth_m2m' ? 'oauth_m2m' : 'pat'
    const config: Record<string, unknown> = {
      host: row.host,
      http_path: (extraConfig.http_path as string) || '',
      auth_type: authType,
    }
    if (row.database) {
      config.catalog = row.database
    }
    if (extraConfig.schema) {
      config.schema = extraConfig.schema
    }
    if (authType === 'pat') {
      config.token = password
    } else {
      config.client_id = (extraConfig.client_id as string) || ''
      config.client_secret = secondarySecret
    }

    return { type: 'databricks', name: row.name, config }
  }

  if (row.connectionType === 'dremio') {
    const authType = extraConfig.auth_type === 'password' ? 'password' : 'pat'
    const authConfig =
      authType === 'password' ? { password } : { pat: password }
    return {
      type: 'dremio',
      name: row.name,
      config: {
        host: row.host,
        port: row.port,
        user: row.username,
        dremio_space: row.database || `@${row.username}`,
        ...authConfig,
        ...extraConfig,
      },
    }
  }

  if (row.connectionType === 'duckdb') {
    return {
      type: 'duckdb',
      name: row.name,
      config: { path: row.database },
    }
  }

  if (row.connectionType === 'oracle') {
    const schema = (extraConfig.schema as string) || row.username.toUpperCase()
    return {
      type: 'oracle',
      name: row.name,
      config: {
        host: row.host,
        port: row.port,
        user: row.username,
        password,
        service: row.database,
        schema,
      },
    }
  }

  if (row.connectionType === 'spark') {
    const secretType =
      extraConfig.secret_type === 'password' || extraConfig.secret_type === 'token'
        ? extraConfig.secret_type
        : 'none'
    const credential = secretType === 'none' ? '' : password
    return {
      type: 'spark',
      name: row.name,
      config: {
        host: row.host,
        port: row.port,
        schema: row.database,
        user: row.username,
        ...extraConfig,
        ...(secretType === 'password' ? { password: credential } : {}),
        ...(secretType === 'token' ? { token: credential } : {}),
      },
    }
  }

  if (row.connectionType === 'postgresql') {
    return {
      type: 'postgresql',
      name: row.name,
      config: {
        host: row.host,
        port: row.port,
        user: row.username,
        password,
        dbname: row.database,
        schema: (extraConfig.schema as string) || 'public',
      },
    }
  }

  throw new Error(`Unhandled connection type: ${row.connectionType}`)
}
