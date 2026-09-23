import {
  DEFAULT_INIT_TEMPLATE,
  formatTemplateLabel,
  formatTemplateDescription,
  resolveInitialTemplate,
} from "@/features/projects/model/init-templates"

describe("projects/model/init-templates", () => {
  it("formats template labels with readable defaults", () => {
    expect(formatTemplateLabel("empty")).toBe("Blank dbt project")
    expect(formatTemplateLabel("jaffle_shop")).toBe("Jaffle Shop (E-commerce demo)")
    expect(formatTemplateLabel("custom_template")).toBe("custom_template")
  })

  it("formats template descriptions", () => {
    expect(formatTemplateDescription("empty")).toContain("standard empty dbt project")
    expect(formatTemplateDescription("unknown_temp")).toBe("Starter project template: unknown_temp")
  })

  it("resolves initial template correctly", () => {
    expect(resolveInitialTemplate(["empty", "starter"], "empty")).toBe("empty")
    expect(resolveInitialTemplate(["starter", "advanced"], "advanced")).toBe("advanced")
    expect(resolveInitialTemplate(["starter"], "missing")).toBe("starter")
    expect(resolveInitialTemplate([])).toBe(DEFAULT_INIT_TEMPLATE)
  })
})
