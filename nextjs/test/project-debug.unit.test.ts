import { parseDebugSummary, formatTargetLabel } from "@/features/projects/model/debug"

describe("projects/model/debug", () => {
  it("formats target label with default dev", () => {
    expect(formatTargetLabel()).toBe("dev")
    expect(formatTargetLabel("")).toBe("dev")
    expect(formatTargetLabel("prod")).toBe("prod")
  })

  it("parses debug output with passes", () => {
    const output = `
dbt version: 1.10.0
profiles.yml file [OK found and valid]
dbt_project.yml file [OK found and valid]
Connection test: [OK connection ok]
All checks passed!
`
    const summary = parseDebugSummary(output)
    expect(summary.passes).toBe(3)
    expect(summary.errors).toBe(0)
    expect(summary.statusText).toBe("All checks passed")
  })

  it("parses debug output with errors", () => {
    const output = `
profiles.yml file [OK found and valid]
Connection test: [FAIL]
ERROR: could not connect to server
`
    const summary = parseDebugSummary(output)
    expect(summary.errors).toBe(2)
    expect(summary.statusText).toBe("2 errors detected")
  })

  it("parses debug output with warnings", () => {
    const output = `
profiles.yml file [OK found and valid]
[WARNING]: deprecated configuration used
Connection test: [OK connection ok]
`
    const summary = parseDebugSummary(output)
    expect(summary.warnings).toBe(1)
    expect(summary.errors).toBe(0)
    expect(summary.statusText).toBe("Passed with 1 warning")
  })
})
