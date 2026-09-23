import { describe, expect, it } from 'vitest'
import { buildConnectionTestPayload } from '@/features/connections/model/test-payload'

describe('buildConnectionTestPayload', () => {
  it('maps Snowflake connection with password auth', () => {
    const row = {
      name: 'Production Snowflake',
      connectionType: 'snowflake',
      host: 'xy12345.us-east-1.snowflakecomputing.com',
      port: 443,
      database: 'ANALYTICS',
      username: 'dbt_user',
      extraConfig: {
        account: 'xy12345.us-east-1',
        auth_type: 'password',
        role: 'TRANSFORMER',
        warehouse: 'COMPUTE_WH',
        schema: 'PUBLIC',
      },
    }
    const secrets = {
      password: 'mypassword123',
    }

    const payload = buildConnectionTestPayload(row, secrets)
    expect(payload).toEqual({
      type: 'snowflake',
      name: 'Production Snowflake',
      config: {
        account: 'xy12345.us-east-1',
        user: 'dbt_user',
        auth_type: 'password',
        password: 'mypassword123',
        role: 'TRANSFORMER',
        warehouse: 'COMPUTE_WH',
        database: 'ANALYTICS',
        schema: 'PUBLIC',
      },
    })
  })

  it('maps Snowflake connection with keypair auth and passphrase', () => {
    const row = {
      name: 'Snowflake Keypair',
      connectionType: 'snowflake',
      host: 'myorg-myaccount.snowflakecomputing.com',
      port: 443,
      database: 'PROD_DB',
      username: 'service_user',
      extraConfig: {
        account: 'myorg-myaccount',
        auth_type: 'keypair',
      },
    }
    const secrets = {
      password: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----',
      secondary_secret: 'passphrase123',
    }

    const payload = buildConnectionTestPayload(row, secrets)
    expect(payload).toEqual({
      type: 'snowflake',
      name: 'Snowflake Keypair',
      config: {
        account: 'myorg-myaccount',
        user: 'service_user',
        auth_type: 'keypair',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----',
        private_key_passphrase: 'passphrase123',
        database: 'PROD_DB',
        schema: '',
      },
    })
  })

  it('maps Databricks connection with PAT auth', () => {
    const row = {
      name: 'Databricks Analytics',
      connectionType: 'databricks',
      host: 'dbc-12345678-90ab.cloud.databricks.com',
      port: 443,
      database: 'main',
      username: '',
      extraConfig: {
        auth_type: 'pat',
        http_path: '/sql/1.0/warehouses/0123456789abcdef',
        schema: 'default',
      },
    }
    const secrets = {
      password: 'dapi1234567890abcdef',
    }

    const payload = buildConnectionTestPayload(row, secrets)
    expect(payload).toEqual({
      type: 'databricks',
      name: 'Databricks Analytics',
      config: {
        host: 'dbc-12345678-90ab.cloud.databricks.com',
        http_path: '/sql/1.0/warehouses/0123456789abcdef',
        auth_type: 'pat',
        token: 'dapi1234567890abcdef',
        catalog: 'main',
        schema: 'default',
      },
    })
  })

  it('maps Databricks connection with OAuth M2M auth', () => {
    const row = {
      name: 'Databricks Service Principal',
      connectionType: 'databricks',
      host: 'adb-1234567890.12.azuredatabricks.net',
      port: 443,
      database: '',
      username: '',
      extraConfig: {
        auth_type: 'oauth_m2m',
        http_path: '/sql/1.0/warehouses/fedcba9876543210',
        client_id: 'app-client-uuid-1234',
      },
    }
    const secrets = {
      secondary_secret: 'oauth-client-secret-xyz',
    }

    const payload = buildConnectionTestPayload(row, secrets)
    expect(payload).toEqual({
      type: 'databricks',
      name: 'Databricks Service Principal',
      config: {
        host: 'adb-1234567890.12.azuredatabricks.net',
        http_path: '/sql/1.0/warehouses/fedcba9876543210',
        auth_type: 'oauth_m2m',
        client_id: 'app-client-uuid-1234',
        client_secret: 'oauth-client-secret-xyz',
      },
    })
  })

  it('maps PostgreSQL connection', () => {
    const row = {
      name: 'My Postgres',
      connectionType: 'postgresql',
      host: 'postgres.internal',
      port: 5432,
      database: 'dbt_test',
      username: 'db_admin',
      sslMode: 'require',
      extraConfig: {
        schema: 'analytics',
      },
    }
    const secrets = {
      password: 'pgsecretpassword',
    }

    const payload = buildConnectionTestPayload(row, secrets)
    expect(payload).toEqual({
      type: 'postgresql',
      name: 'My Postgres',
      config: {
        host: 'postgres.internal',
        port: 5432,
        user: 'db_admin',
        password: 'pgsecretpassword',
        dbname: 'dbt_test',
        schema: 'analytics',
      },
    })
  })

  it('throws for unhandled or unknown connection types', () => {
    const row = {
      name: 'Custom DB',
      connectionType: 'unsupported_db',
      host: 'localhost',
      port: 1234,
      database: 'test',
      username: 'user',
    }
    expect(() => buildConnectionTestPayload(row)).toThrow(
      /Unhandled connection type: unsupported_db/,
    )
  })
})
