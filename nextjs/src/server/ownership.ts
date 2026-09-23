import 'server-only'
import { db } from '@/server/db'

/**
 * Shared row-ownership checks, used by every feature's server.ts that guards a
 * mutation behind "does this row belong to the caller". Kept here rather than
 * duplicated per feature: `dbtProject`, `dremioSource`, `connection`,
 * `ingestSource` and `dbtSchedule` rows are all checked through this one path,
 * so a change to what "not found or not authorized" means only has one place
 * to change.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function ensureOwnership(model: string, id: string, userId: string) {
  const record = await (db as any)[model].findUnique({ where: { id } })
  if (!record || record.createdBy !== userId) {
    throw new Error('Not found or not authorized')
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Targets and schedules hang off a project rather than owning a `createdBy`
 * column themselves, so they check ownership through the parent project
 * instead of `ensureOwnership`.
 */
export async function ensureProjectOwnership(projectId: string, userId: string) {
  const project = await db.dbtProject.findFirst({
    where: { id: projectId, createdBy: userId, deletedAt: null },
    select: { id: true },
  })
  if (!project) throw new Error('Not found or not authorized')
}
