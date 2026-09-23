/**
 * Pure helper functions for dbt init starter templates
 */

export const DEFAULT_INIT_TEMPLATE = "empty"

export const TEMPLATE_LABELS: Record<string, string> = {
  empty: "Blank dbt project",
  jaffle_shop: "Jaffle Shop (E-commerce demo)",
  duckdb_demo: "DuckDB Analytics starter",
}

export const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  empty: "Creates a standard empty dbt project with basic models/ directory structure and dbt_project.yml.",
  jaffle_shop: "A sample e-commerce dbt project with customers, orders, and staging models.",
  duckdb_demo: "A ready-to-run DuckDB demo project with pre-configured local data.",
}

export function formatTemplateLabel(template: string): string {
  return TEMPLATE_LABELS[template] ?? template
}

export function formatTemplateDescription(template: string): string {
  return TEMPLATE_DESCRIPTIONS[template] ?? `Starter project template: ${template}`
}

export function resolveInitialTemplate(
  templates: string[],
  serverDefault?: string
): string {
  if (serverDefault && templates.includes(serverDefault)) {
    return serverDefault
  }
  if (templates.includes(DEFAULT_INIT_TEMPLATE)) {
    return DEFAULT_INIT_TEMPLATE
  }
  return templates[0] ?? DEFAULT_INIT_TEMPLATE
}
