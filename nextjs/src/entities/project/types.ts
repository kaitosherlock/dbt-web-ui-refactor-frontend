/**
 * A dbt project the way the UI reads it: snake_case, because the UI was
 * written against Supabase's column names and `entities/project/api.ts`
 * maps Prisma's camelCase rows back to this shape (see `toSnakeProject`).
 */
export interface DbtProject {
  id: string
  name: string
  description: string | null
  git_url: string | null
  git_branch: string
  sync_status: string
  dremio_source_id: string | null
}
