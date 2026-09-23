import { describe, expect, it } from "vitest"
import {
  coerceVarValue,
  validateVars,
  validateSample,
  validateEventTime,
  validateSelectorName,
  parseSelectors,
  buildRunOptionsPayload,
  hasActiveRunOptions,
  resolveStateTargets,
} from "../src/features/develop/model/run-options"

describe("run-options pure helpers", () => {
  describe("coerceVarValue", () => {
    it("converts boolean, numbers and null strings to primitives", () => {
      expect(coerceVarValue("true")).toBe(true)
      expect(coerceVarValue("false")).toBe(false)
      expect(coerceVarValue("null")).toBe(null)
      expect(coerceVarValue("42")).toBe(42)
      expect(coerceVarValue("3.14")).toBe(3.14)
    })

    it("parses valid JSON objects and arrays", () => {
      expect(coerceVarValue('{"id": 1, "flag": true}')).toEqual({ id: 1, flag: true })
      expect(coerceVarValue("[1, 2, 3]")).toEqual([1, 2, 3])
    })

    it("preserves standard string values", () => {
      expect(coerceVarValue("hello world")).toBe("hello world")
      expect(coerceVarValue("0123")).toBe("0123") // leading zero
    })
  })

  describe("validateVars", () => {
    it("accepts empty or null input", () => {
      expect(validateVars(null).valid).toBe(true)
      expect(validateVars([]).valid).toBe(true)
    })

    it("accepts valid key-value pairs", () => {
      const result = validateVars([
        { key: "env", value: "prod" },
        { key: "retries", value: "3" },
        { key: "active", value: "true" },
      ])
      expect(result.valid).toBe(true)
      expect(result.vars).toEqual({
        env: "prod",
        retries: 3,
        active: true,
      })
    })

    it("rejects an entry with an empty key", () => {
      const result = validateVars([{ key: "", value: "something" }])
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/key cannot be empty/i)
    })

    it("rejects vars larger than 16 KiB", () => {
      const hugeString = "x".repeat(17 * 1024)
      const result = validateVars({ huge: hugeString })
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/exceeds maximum limit of 16 KiB/i)
    })
  })

  describe("validateSample", () => {
    it("accepts empty or whitespace values", () => {
      expect(validateSample("").valid).toBe(true)
      expect(validateSample(null).valid).toBe(true)
      expect(validateSample("   ").valid).toBe(true)
    })

    it("accepts valid '<count> <grain>' formats", () => {
      expect(validateSample("3 days")).toEqual({ valid: true, normalized: "3 days" })
      expect(validateSample("1 hour")).toEqual({ valid: true, normalized: "1 hour" })
      expect(validateSample("12 months")).toEqual({ valid: true, normalized: "12 months" })
      expect(validateSample("2 years")).toEqual({ valid: true, normalized: "2 years" })
      expect(validateSample("  5 DAYS  ")).toEqual({ valid: true, normalized: "5 days" })
    })

    it("rejects invalid grains", () => {
      const result = validateSample("3 weeks")
      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/grain one of hour, day, month, year/i)
    })

    it("rejects non-positive counts and non-numbers", () => {
      expect(validateSample("0 days").valid).toBe(false)
      expect(validateSample("several days").valid).toBe(false)
      expect(validateSample("-2 days").valid).toBe(false)
    })

    it("rejects input longer than 32 characters", () => {
      const longInput = "100000000000000000000000000000000000000000 days"
      expect(validateSample(longInput).valid).toBe(false)
    })
  })

  describe("validateEventTime", () => {
    it("accepts when both are empty", () => {
      expect(validateEventTime("", "").valid).toBe(true)
      expect(validateEventTime(null, null).valid).toBe(true)
    })

    it("rejects when only one is provided", () => {
      const r1 = validateEventTime("2026-01-01T00:00:00Z", "")
      expect(r1.valid).toBe(false)
      expect(r1.error).toMatch(/must be given together/i)

      const r2 = validateEventTime("", "2026-01-02T00:00:00Z")
      expect(r2.valid).toBe(false)
      expect(r2.error).toMatch(/must be given together/i)
    })

    it("rejects invalid ISO datetime strings", () => {
      const res = validateEventTime("not-a-date", "2026-01-02T00:00:00Z")
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/valid ISO 8601/i)
    })

    it("rejects when start is not before end", () => {
      const r1 = validateEventTime("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")
      expect(r1.valid).toBe(false)
      expect(r1.error).toMatch(/start must be before event_time_end/i)

      const r2 = validateEventTime("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      expect(r2.valid).toBe(false)
      expect(r2.error).toMatch(/start must be before event_time_end/i)
    })

    it("accepts valid start and end datetimes", () => {
      const res = validateEventTime("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")
      expect(res.valid).toBe(true)
      expect(res.startIso).toBeDefined()
      expect(res.endIso).toBeDefined()
    })
  })

  describe("validateSelectorName", () => {
    it("accepts valid selector identifiers", () => {
      expect(validateSelectorName("nightly_orders").valid).toBe(true)
      expect(validateSelectorName("model-v2.sub").valid).toBe(true)
      expect(validateSelectorName("").valid).toBe(true)
    })

    it("rejects invalid selector names with spaces or symbols", () => {
      expect(validateSelectorName("my selector").valid).toBe(false)
      expect(validateSelectorName("select; rm -rf").valid).toBe(false)
    })
  })

  describe("parseSelectors", () => {
    it("parses valid selectors.yml content", () => {
      const yaml = `
selectors:
  - name: nightly_diet
    description: "run nightly"
    definition: "tag:nightly"
  - name: daily_marts
    definition: "models/marts"
`
      const selectors = parseSelectors(yaml)
      expect(selectors).toEqual(["nightly_diet", "daily_marts"])
    })

    it("handles comments and empty lines safely", () => {
      const yaml = `
# Project selectors
selectors:
  # Daily run
  - name: daily
  - name: hourly
`
      expect(parseSelectors(yaml)).toEqual(["daily", "hourly"])
    })

    it("returns empty array for empty or unparseable input", () => {
      expect(parseSelectors("")).toEqual([])
      expect(parseSelectors("version: 2\nmodels: []")).toEqual([])
    })
  })

  describe("buildRunOptionsPayload", () => {
    it("constructs payload for run command with vars, empty, sample", () => {
      const payload = buildRunOptionsPayload(
        {
          varEntries: [{ key: "branch", value: "main" }],
          empty: true,
          sample: "3 days",
          full_refresh: true,
        },
        "run",
      )
      expect(payload).toEqual({
        vars: { branch: "main" },
        empty: true,
        sample: "3 days",
        full_refresh: true,
      })
    })

    it("filters out sample and empty when targeting test command", () => {
      const payload = buildRunOptionsPayload(
        {
          varEntries: [{ key: "branch", value: "main" }],
          empty: true,
          sample: "3 days",
          full_refresh: true,
        },
        "test",
      )
      // test does not support empty, sample, or full_refresh
      expect(payload).toEqual({
        vars: { branch: "main" },
      })
    })

    it("includes full_refresh for seed command", () => {
      const payload = buildRunOptionsPayload(
        {
          full_refresh: true,
          empty: true, // not supported on seed
        },
        "seed",
      )
      expect(payload).toEqual({
        full_refresh: true,
      })
    })

    it("attaches defer and favor_state only when state_target is set", () => {
      const withoutTarget = buildRunOptionsPayload(
        {
          defer: true,
          favor_state: true,
        },
        "build",
      )
      expect(withoutTarget.defer).toBeUndefined()
      expect(withoutTarget.favor_state).toBeUndefined()

      const withTarget = buildRunOptionsPayload(
        {
          state_target: "prod",
          defer: true,
          favor_state: true,
        },
        "build",
      )
      expect(withTarget.state_target).toBe("prod")
      expect(withTarget.defer).toBe(true)
      expect(withTarget.favor_state).toBe(true)
    })
  })

  describe("hasActiveRunOptions", () => {
    it("returns true when any option is configured", () => {
      expect(hasActiveRunOptions({ full_refresh: true })).toBe(true)
      expect(hasActiveRunOptions({ empty: true })).toBe(true)
      expect(hasActiveRunOptions({ sample: "3 days" })).toBe(true)
      expect(hasActiveRunOptions({ vars: { a: 1 } })).toBe(true)
      expect(hasActiveRunOptions({ state_target: "prod", defer: true })).toBe(true)
      expect(hasActiveRunOptions({})).toBe(false)
    })
  })

  describe("resolveStateTargets", () => {
    it("excludes 'dev' from candidate targets and lists non-dev targets", () => {
      const res = resolveStateTargets({
        availableTargets: ["dev", "staging", "prod"],
        stateTargets: [{ target: "dev", manifest: true }],
        currentTarget: "dev",
      })
      expect(res.candidateTargets).toEqual(["staging", "prod"])
      expect(res.candidateTargets).not.toContain("dev")
    })

    it("combines targets from availableTargets and GET /dbt/state reports", () => {
      const res = resolveStateTargets({
        availableTargets: ["staging"],
        stateTargets: [
          { target: "prod", manifest: true },
          { target: "nightly_schedule", manifest: true },
        ],
      })
      expect(res.candidateTargets).toEqual(["staging", "prod", "nightly_schedule"])
    })

    it("defaults to the first target with state", () => {
      const res = resolveStateTargets({
        availableTargets: ["staging", "prod"],
        stateTargets: [
          { target: "staging", manifest: false },
          { target: "prod", manifest: true },
        ],
      })
      expect(res.selectedTarget).toBe("prod")
      expect(res.hasState).toBe(true)
    })

    it("preserves current non-dev target if present in candidates", () => {
      const res = resolveStateTargets({
        availableTargets: ["staging", "prod"],
        stateTargets: [{ target: "prod", manifest: true }],
        currentTarget: "staging",
      })
      expect(res.selectedTarget).toBe("staging")
      expect(res.hasState).toBe(false)
    })

    it("replaces 'dev' currentTarget with the first target with state", () => {
      const res = resolveStateTargets({
        availableTargets: ["staging", "prod"],
        stateTargets: [{ target: "prod", manifest: true }],
        currentTarget: "dev",
      })
      expect(res.selectedTarget).toBe("prod")
      expect(res.hasState).toBe(true)
    })

    it("handles empty targets gracefully", () => {
      const res = resolveStateTargets({
        availableTargets: ["dev"],
        stateTargets: [],
      })
      expect(res.candidateTargets).toEqual([])
      expect(res.selectedTarget).toBe("")
      expect(res.hasState).toBe(false)
    })
  })
})
