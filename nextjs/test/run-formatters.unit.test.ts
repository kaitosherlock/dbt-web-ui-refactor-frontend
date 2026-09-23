import { describe, expect, it } from "vitest"
import {
  getFullCommand,
  getCommandName,
  formatCommandLabel,
  COMMAND_LABELS,
} from "@/entities/run/model/formatters"
import type { DbtRun } from "@/entities/run/types"

const run = (overrides: Partial<DbtRun>): DbtRun =>
  ({ id: "r1", command: "run", selector: null, status: "success", ...overrides }) as DbtRun

describe("getFullCommand", () => {
  it("renders a plain command", () => {
    expect(getFullCommand(run({ command: "build" }))).toBe("dbt build")
  })

  it("appends the selector", () => {
    expect(getFullCommand(run({ command: "run", selector: "tag:daily+" }))).toBe(
      "dbt run --select tag:daily+",
    )
  })

  it("spells source_freshness the way dbt does", () => {
    // The enum value has an underscore; the CLI takes two words. Showing the
    // enum spelling would not match the command that actually ran.
    expect(getFullCommand(run({ command: "source_freshness" }))).toBe("dbt source freshness")
  })

  it("spells run_operation as run-operation", () => {
    expect(getFullCommand(run({ command: "run_operation" }))).toBe("dbt run-operation")
  })

  it("formats new enum commands retry, clone, parse, ls, debug", () => {
    expect(getFullCommand(run({ command: "retry" }))).toBe("dbt retry")
    expect(getFullCommand(run({ command: "clone" }))).toBe("dbt clone")
    expect(getFullCommand(run({ command: "parse" }))).toBe("dbt parse")
    expect(getFullCommand(run({ command: "ls" }))).toBe("dbt ls")
    expect(getFullCommand(run({ command: "debug" }))).toBe("dbt debug")
  })
})

describe("COMMAND_LABELS & formatCommandLabel", () => {
  it("has labels for all commands including new additions", () => {
    expect(formatCommandLabel("run_operation")).toBe("dbt run-operation")
    expect(formatCommandLabel("source_freshness")).toBe("dbt source freshness")
    expect(formatCommandLabel("retry")).toBe("dbt retry")
    expect(formatCommandLabel("clone")).toBe("dbt clone")
    expect(formatCommandLabel("parse")).toBe("dbt parse")
    expect(formatCommandLabel("ls")).toBe("dbt ls")
    expect(formatCommandLabel("debug")).toBe("dbt debug")
    expect(COMMAND_LABELS["clone"]).toBe("dbt clone")
  })

  it("normalizes command name correctly", () => {
    expect(getCommandName("source_freshness")).toBe("source freshness")
    expect(getCommandName("run_operation")).toBe("run-operation")
    expect(getCommandName("run")).toBe("run")
  })
})
