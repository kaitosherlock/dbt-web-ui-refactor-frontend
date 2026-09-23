import { describe, expect, it } from 'vitest'
import {
  normalizeSnowflakeAccount,
  snowflakeAccountHost,
  normalizeDatabricksHost,
  normalizeDatabricksHttpPath,
  normalizeWarehouseSchema,
  getSecretFieldState,
  ConnectionValidationError,
} from '@/features/connections/model/validation'

describe('normalizeSnowflakeAccount and snowflakeAccountHost', () => {
  it('normalizes valid account identifiers and converts underscores to hyphens', () => {
    expect(normalizeSnowflakeAccount('xy12345.us-east-1')).toBe('xy12345.us-east-1')
    expect(normalizeSnowflakeAccount('xy12345_us_east_1')).toBe('xy12345-us-east-1')
    expect(normalizeSnowflakeAccount('xy12345_eu_west_1')).toBe('xy12345-eu-west-1')
    expect(normalizeSnowflakeAccount('myorg-myaccount')).toBe('myorg-myaccount')
    expect(normalizeSnowflakeAccount('  myorg-myaccount  ')).toBe('myorg-myaccount')
  })

  it('computes snowflakeAccountHost correctly', () => {
    expect(snowflakeAccountHost('xy12345.us-east-1')).toBe('xy12345.us-east-1.snowflakecomputing.com')
    expect(snowflakeAccountHost('myorg-myaccount')).toBe('myorg-myaccount.snowflakecomputing.com')
  })

  it('rejects empty account identifier', () => {
    expect(() => normalizeSnowflakeAccount('')).toThrow(ConnectionValidationError)
    expect(() => normalizeSnowflakeAccount('   ')).toThrow(
      /A Snowflake connection needs an account identifier/,
    )
  })

  it('rejects schemes and URLs', () => {
    expect(() => normalizeSnowflakeAccount('https://xy12345.snowflakecomputing.com')).toThrow(
      /Give only the account identifier, not a URL or host name/,
    )
    expect(() => normalizeSnowflakeAccount('http://xy12345.us-east-1')).toThrow(
      /Give only the account identifier, not a URL or host name/,
    )
  })

  it('rejects trailing slashes', () => {
    expect(() => normalizeSnowflakeAccount('xy12345.us-east-1/')).toThrow(
      /Give only the account identifier, not a URL or host name/,
    )
  })

  it('rejects .snowflakecomputing.com suffix with helpful message', () => {
    expect(() => normalizeSnowflakeAccount('xy12345.snowflakecomputing.com')).toThrow(
      /Give only the account identifier, not a URL or host name/,
    )
  })

  it('rejects invalid characters', () => {
    expect(() => normalizeSnowflakeAccount('xy12345:443')).toThrow(
      /Give only the account identifier, not a URL or host name/,
    )
    expect(() => normalizeSnowflakeAccount('my account!@#')).toThrow(ConnectionValidationError)
  })
})

describe('normalizeDatabricksHost', () => {
  it('accepts valid workspace hostnames', () => {
    expect(normalizeDatabricksHost('dbc-12345678-90ab.cloud.databricks.com')).toBe(
      'dbc-12345678-90ab.cloud.databricks.com',
    )
    expect(normalizeDatabricksHost('adb-1234567890.12.azuredatabricks.net')).toBe(
      'adb-1234567890.12.azuredatabricks.net',
    )
    expect(normalizeDatabricksHost('1234567890.gcp.databricks.com')).toBe(
      '1234567890.gcp.databricks.com',
    )
    expect(normalizeDatabricksHost('  dbc-test.cloud.databricks.com  ')).toBe(
      'dbc-test.cloud.databricks.com',
    )
  })

  it('rejects empty host', () => {
    expect(() => normalizeDatabricksHost('')).toThrow(ConnectionValidationError)
    expect(() => normalizeDatabricksHost('   ')).toThrow(
      /A Databricks connection needs a workspace hostname/,
    )
  })

  it('rejects schemes and protocol prefixes', () => {
    expect(() => normalizeDatabricksHost('https://dbc-test.cloud.databricks.com')).toThrow(
      /Give only a Databricks workspace hostname ending in/,
    )
    expect(() => normalizeDatabricksHost('http://dbc-test.cloud.databricks.com')).toThrow(
      /Give only a Databricks workspace hostname ending in/,
    )
  })

  it('rejects paths and trailing slashes', () => {
    expect(() => normalizeDatabricksHost('dbc-test.cloud.databricks.com/')).toThrow(
      /Give only a Databricks workspace hostname ending in/,
    )
    expect(() => normalizeDatabricksHost('dbc-test.cloud.databricks.com/sql/1.0')).toThrow(
      /Give only a Databricks workspace hostname ending in/,
    )
  })

  it('rejects port numbers and query parameters', () => {
    expect(() => normalizeDatabricksHost('dbc-test.cloud.databricks.com:443')).toThrow(
      /Give only a Databricks workspace hostname ending in/,
    )
    expect(() => normalizeDatabricksHost('dbc-test.cloud.databricks.com?o=123')).toThrow(
      /Give only a Databricks workspace hostname ending in/,
    )
  })
})

describe('normalizeDatabricksHttpPath', () => {
  it('accepts valid SQL warehouse HTTP paths', () => {
    expect(normalizeDatabricksHttpPath('/sql/1.0/warehouses/0123456789abcdef')).toBe(
      '/sql/1.0/warehouses/0123456789abcdef',
    )
    expect(normalizeDatabricksHttpPath('  /sql/1.0/warehouses/a1b2c3d4e5f67890  ')).toBe(
      '/sql/1.0/warehouses/a1b2c3d4e5f67890',
    )
  })

  it('accepts valid cluster HTTP paths', () => {
    expect(normalizeDatabricksHttpPath('/sql/protocolv1/o/123456789/0123-456789-abcdef')).toBe(
      '/sql/protocolv1/o/123456789/0123-456789-abcdef',
    )
  })

  it('rejects empty HTTP path', () => {
    expect(() => normalizeDatabricksHttpPath('')).toThrow(ConnectionValidationError)
    expect(() => normalizeDatabricksHttpPath('   ')).toThrow(
      /Give a Databricks HTTP path shaped like/,
    )
  })

  it('rejects paths that do not start with a slash', () => {
    expect(() => normalizeDatabricksHttpPath('sql/1.0/warehouses/0123456789abcdef')).toThrow(
      /Give a Databricks HTTP path shaped like/,
    )
  })

  it('rejects paths with unexpected prefixes', () => {
    expect(() => normalizeDatabricksHttpPath('/api/2.0/clusters')).toThrow(
      /Give a Databricks HTTP path shaped like/,
    )
  })
})

describe('normalizeWarehouseSchema', () => {
  it('accepts and trims valid schema names', () => {
    expect(normalizeWarehouseSchema('PUBLIC', 'Snowflake')).toBe('PUBLIC')
    expect(normalizeWarehouseSchema('  analytics  ', 'Databricks')).toBe('analytics')
    expect(normalizeWarehouseSchema('dbt_prod', 'Snowflake')).toBe('dbt_prod')
  })

  it('rejects empty or whitespace-only schema with warehouse-specific message', () => {
    expect(() => normalizeWarehouseSchema('', 'Databricks')).toThrow(ConnectionValidationError)
    expect(() => normalizeWarehouseSchema('   ', 'Databricks')).toThrow(
      /A Databricks connection needs a schema/,
    )
    expect(() => normalizeWarehouseSchema('', 'Snowflake')).toThrow(
      /A Snowflake connection needs a schema/,
    )
  })

  it('rejects null or undefined schema', () => {
    expect(() => normalizeWarehouseSchema(null, 'Databricks')).toThrow(ConnectionValidationError)
    expect(() => normalizeWarehouseSchema(undefined, 'Snowflake')).toThrow(ConnectionValidationError)
  })
})

describe('getSecretFieldState', () => {
  it('requires secret when creating a new connection (isEdit is false)', () => {
    expect(
      getSecretFieldState({
        isEdit: false,
        storedAuthType: 'pat',
        selectedAuthType: 'pat',
      }),
    ).toEqual({
      canKeepExisting: false,
      isRequired: true,
    })
  })

  it('allows keeping existing secret when stored auth_type equals selected auth_type', () => {
    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: 'pat',
        selectedAuthType: 'pat',
      }),
    ).toEqual({
      canKeepExisting: true,
      isRequired: false,
    })

    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: 'password',
        selectedAuthType: 'password',
      }),
    ).toEqual({
      canKeepExisting: true,
      isRequired: false,
    })

    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: 'keypair',
        selectedAuthType: 'keypair',
      }),
    ).toEqual({
      canKeepExisting: true,
      isRequired: false,
    })
  })

  it('requires secret when switching auth type (e.g. PAT -> OAuth M2M, or password -> keypair)', () => {
    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: 'pat',
        selectedAuthType: 'oauth_m2m',
      }),
    ).toEqual({
      canKeepExisting: false,
      isRequired: true,
    })

    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: 'oauth_m2m',
        selectedAuthType: 'pat',
      }),
    ).toEqual({
      canKeepExisting: false,
      isRequired: true,
    })

    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: 'password',
        selectedAuthType: 'keypair',
      }),
    ).toEqual({
      canKeepExisting: false,
      isRequired: true,
    })

    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: 'keypair',
        selectedAuthType: 'password',
      }),
    ).toEqual({
      canKeepExisting: false,
      isRequired: true,
    })
  })

  it('requires secret when storedAuthType is missing or null', () => {
    expect(
      getSecretFieldState({
        isEdit: true,
        storedAuthType: null,
        selectedAuthType: 'pat',
      }),
    ).toEqual({
      canKeepExisting: false,
      isRequired: true,
    })
  })
})
