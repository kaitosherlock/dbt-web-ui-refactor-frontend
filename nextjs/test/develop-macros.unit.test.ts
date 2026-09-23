import {
  isValidMacroName,
  filterMacros,
  parseMacroArgValue,
  buildMacroArgsPayload,
  type DbtMacro,
} from "@/features/develop/model/macros"

describe("develop/model/macros", () => {
  it("validates macro names", () => {
    expect(isValidMacroName("my_macro")).toBe(true)
    expect(isValidMacroName("dbt_utils.clean_stale_models")).toBe(true)
    expect(isValidMacroName("123bad")).toBe(false)
    expect(isValidMacroName("bad-macro")).toBe(false)
    expect(isValidMacroName("pkg.sub.bad")).toBe(false)
  })

  it("filters macros by query and package", () => {
    const macros: DbtMacro[] = [
      {
        unique_id: "macro.my_project.generate_schema_name",
        name: "generate_schema_name",
        package_name: "my_project",
        description: "Custom schema naming",
      },
      {
        unique_id: "macro.dbt_utils.star",
        name: "star",
        package_name: "dbt_utils",
        description: "Generate select star",
      },
      {
        unique_id: "macro.dbt.default__stage_custom",
        name: "default__stage_custom",
        package_name: "dbt",
      },
    ]

    const searched = filterMacros(macros, "star")
    expect(searched).toHaveLength(1)
    expect(searched[0].name).toBe("star")

    const byPkg = filterMacros(macros, "", "my_project")
    expect(byPkg).toHaveLength(1)
    expect(byPkg[0].package_name).toBe("my_project")
  })

  it("parses different argument values correctly", () => {
    expect(parseMacroArgValue("")).toBeUndefined()
    expect(parseMacroArgValue("true")).toBe(true)
    expect(parseMacroArgValue("false")).toBe(false)
    expect(parseMacroArgValue("null")).toBeNull()
    expect(parseMacroArgValue("42")).toBe(42)
    expect(parseMacroArgValue("3.14")).toBe(3.14)
    expect(parseMacroArgValue('{"table": "orders"}')).toEqual({ table: "orders" })
    expect(parseMacroArgValue('["a", "b"]')).toEqual(["a", "b"])
    expect(parseMacroArgValue("plain string")).toBe("plain string")
  })

  it("builds macro args payload from signature and form values", () => {
    const signature = [
      { name: "relation", default: null },
      { name: "limit", default: 10 },
      { name: "dry_run", default: false },
    ]

    const formValues = {
      relation: "customers",
      limit: "50",
      dry_run: "true",
      unused: "",
    }

    const payload = buildMacroArgsPayload(formValues, signature)
    expect(payload).toEqual({
      relation: "customers",
      limit: 50,
      dry_run: true,
    })
  })
})
