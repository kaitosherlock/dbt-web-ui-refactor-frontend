import { describe, expect, it } from 'vitest'
import {
  CONDITIONAL_DATABASE_EXPR,
  hasConditionalLakeDatabaseLine,
  hasLakeDatabaseLine,
  hasLiteralLakeDatabaseLine,
} from '@/features/projects/model/lakehouseDatabaseLine'

describe('detecting the current +database line', () => {
  it('recognises the literal form in its quoted and unquoted spellings', () => {
    expect(hasLiteralLakeDatabaseLine('    +database: lake\n')).toBe(true)
    expect(hasLiteralLakeDatabaseLine('    +database: "lake"\n')).toBe(true)
    expect(hasLiteralLakeDatabaseLine("    database: 'lake'\n")).toBe(true)
    expect(hasLiteralLakeDatabaseLine('    +database: lakehouse\n')).toBe(false)
  })

  it('recognises the literal form with a trailing comment', () => {
    expect(hasLiteralLakeDatabaseLine('    +database: lake   # DuckLake catalog\n')).toBe(true)
  })

  it('recognises the conditional form and not the literal', () => {
    const line = `    +database: ${CONDITIONAL_DATABASE_EXPR}\n`
    expect(hasConditionalLakeDatabaseLine(line)).toBe(true)
    expect(hasLiteralLakeDatabaseLine(line)).toBe(false)
    expect(hasLakeDatabaseLine(line)).toBe(true)
  })

  it('sees neither form when the key is absent', () => {
    expect(hasLakeDatabaseLine('models:\n  my_project:\n    +materialized: table\n')).toBe(false)
    expect(hasLiteralLakeDatabaseLine('models:\n  my_project:\n    +materialized: table\n')).toBe(false)
  })
})
