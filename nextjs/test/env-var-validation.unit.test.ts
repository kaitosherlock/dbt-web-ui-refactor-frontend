import { describe, expect, it } from 'vitest'
import { validateEnvVarName } from '@/features/projects/model/env-vars'

describe('validateEnvVarName', () => {
  it('accepts valid environment variable names', () => {
    expect(validateEnvVarName('MY_VAR')).toEqual({ valid: true })
    expect(validateEnvVarName('API_KEY_123')).toEqual({ valid: true })
    expect(validateEnvVarName('_INTERNAL_SECRET')).toEqual({ valid: true })
    expect(validateEnvVarName('A')).toEqual({ valid: true })
    expect(validateEnvVarName('DBT_CUSTOM_SETTING')).toEqual({ valid: true })
    expect(validateEnvVarName('CUSTOM_DBT_PROJECT_DIR')).toEqual({ valid: true })
  })

  it('rejects empty or non-string input', () => {
    expect(validateEnvVarName('')).toEqual({
      valid: false,
      error: 'Environment variable name cannot be empty',
    })
    // @ts-expect-error test non-string runtime guard
    expect(validateEnvVarName(null)).toEqual({
      valid: false,
      error: 'Environment variable name cannot be empty',
    })
  })

  it('rejects names with invalid syntax or starting with numbers', () => {
    expect(validateEnvVarName('123_VAR').valid).toBe(false)
    expect(validateEnvVarName('MY-VAR').valid).toBe(false)
    expect(validateEnvVarName('MY VAR').valid).toBe(false)
    expect(validateEnvVarName('VAR!').valid).toBe(false)
    expect(validateEnvVarName('A'.repeat(129)).valid).toBe(false)
  })

  it('rejects forbidden dbt CLI flags', () => {
    const forbidden = [
      'DBT_PROJECT_DIR',
      'DBT_PROFILES_DIR',
      'DBT_TARGET_PATH',
      'DBT_STATE',
      'DBT_LOG_PATH',
      'DBT_FAIL_FAST',
      'DBT_FULL_REFRESH',
      'DBT_TARGET',
      'DBT_DEFER',
      'DBT_SINGLE_THREADED',
      'DBT_WRITE_JSON',
    ]
    for (const name of forbidden) {
      const res = validateEnvVarName(name)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/dbt treats it as a CLI option/)
    }
  })

  it('rejects forbidden dbt CLI flags case-insensitively', () => {
    const res = validateEnvVarName('dbt_project_dir')
    expect(res.valid).toBe(false)
    expect(res.error).toMatch(/dbt treats it as a CLI option/)
  })

  it('rejects system process environment variables', () => {
    for (const name of ['PATH', 'HOME', 'VIRTUAL_ENV', 'path', 'home']) {
      const res = validateEnvVarName(name)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/it controls the dbt process environment/)
    }
  })

  it('rejects Python and native loading variables', () => {
    for (const name of [
      'PYTHONPATH',
      'PYTHONHOME',
      'PYTHON_CUSTOM',
      'LD_LIBRARY_PATH',
      'LD_PRELOAD',
      'DYLD_LIBRARY_PATH',
      'UV_CACHE_DIR',
      'UV_PROJECT_ENVIRONMENT',
    ]) {
      const res = validateEnvVarName(name)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/it controls Python or native code loading/)
    }
  })

  it('rejects server-managed secret prefixes and names', () => {
    expect(validateEnvVarName('DBT_ENV_SECRET_DBT_CRAFT_POSTGRES').valid).toBe(false)
    expect(validateEnvVarName('DBT_ENV_SECRET_DBT_CRAFT_CUSTOM').error).toMatch(
      /reserved for a server-managed credential/,
    )
    expect(validateEnvVarName('DBT_ENV_SECRET_LAKE_CATALOG_PASSWORD').valid).toBe(false)
    expect(validateEnvVarName('DBT_ENV_SECRET_LAKE_CATALOG_PASSWORD').error).toMatch(
      /reserved for a server-managed credential/,
    )
  })
})
