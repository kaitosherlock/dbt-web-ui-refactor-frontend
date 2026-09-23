import 'server-only'

import { db } from '@/server/db'
import { getCurrentUserId } from '@/server/session'
import { ensureOwnership, ensureProjectOwnership } from '@/server/ownership'
import { TARGET_NAME_PATTERN } from '@/server/validation'
import { revalidatePath } from 'next/cache'

// --- Projects ---

export async function getProjects(includeDeleted = false) {
  const userId = await getCurrentUserId()
  return db.dbtProject.findMany({
    where: { createdBy: userId, deletedAt: includeDeleted ? undefined : null },
    orderBy: { createdAt: 'desc' },
    include: {
      dremioSource: true,
      connection: true,
      _count: { select: { runs: true } },
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          command: true,
          selector: true,
          modelsTotal: true,
          modelsSuccess: true,
          modelsError: true,
          createdAt: true,
          completedAt: true,
        },
      },
    },
  })
}

export async function getProjectById(id: string) {
  const userId = await getCurrentUserId()
  return db.dbtProject.findFirst({
    where: { id, createdBy: userId },
    include: { dremioSource: true, connection: true },
  })
}

export async function createProject(data: {
  name: string
  description?: string
  dremioSourceId?: string
  connectionId?: string
  gitUrl?: string
  gitBranch?: string
}) {
  const userId = await getCurrentUserId()
  const project = await db.dbtProject.create({
    data: { ...data, createdBy: userId },
  })
  revalidatePath('/develop')
  return project
}

export async function updateProject(id: string, data: {
  name?: string
  description?: string
  gitUrl?: string
  gitBranch?: string
  gitProjectSubdirectory?: string
  stagingDir?: string
  martsDir?: string
  syncStatus?: string
  dremioSourceId?: string | null
  connectionId?: string | null
}) {
  const userId = await getCurrentUserId()
  await ensureOwnership('dbtProject', id, userId)
  const project = await db.dbtProject.update({ where: { id }, data })
  revalidatePath('/develop')
  return project
}

export async function softDeleteProject(id: string) {
  const userId = await getCurrentUserId()
  await ensureOwnership('dbtProject', id, userId)
  await db.dbtProject.update({ where: { id }, data: { deletedAt: new Date() } })
  revalidatePath('/develop')
}

export async function restoreProject(id: string) {
  const userId = await getCurrentUserId()
  await ensureOwnership('dbtProject', id, userId)
  await db.dbtProject.update({ where: { id }, data: { deletedAt: null } })
  revalidatePath('/develop')
}

export async function hardDeleteProject(id: string) {
  const userId = await getCurrentUserId()
  await ensureOwnership('dbtProject', id, userId)
  await db.dbtProject.delete({ where: { id } })
  revalidatePath('/develop')
}

// ---------------------------------------------------------------------------
// Project targets
//
// The project's own connection is always target `dev`; rows here are the extra
// named targets (staging, prod, ...). Ownership runs through the project, not a
// createdBy column, so these cannot use ensureOwnership.
// ---------------------------------------------------------------------------

/** Same shape the backend enforces: it becomes a profiles.yml key and `dbt --target`. */
const RESERVED_TARGET_NAMES = new Set(['dev'])

export type ProjectTargetInput = {
  projectId: string
  name: string
  connectionId: string
}

export async function getProjectTargets(projectId: string) {
  const userId = await getCurrentUserId()
  await ensureProjectOwnership(projectId, userId)
  return db.projectTarget.findMany({
    where: { projectId },
    include: { connection: { select: { id: true, name: true, connectionType: true } } },
    orderBy: { name: 'asc' },
  })
}

function validateProjectTarget(input: ProjectTargetInput) {
  const name = input.name?.trim() ?? ''
  if (!TARGET_NAME_PATTERN.test(name)) {
    throw new Error(
      'Target name must start with a lowercase letter and use only lowercase letters, digits and underscores (max 30 characters)',
    )
  }
  if (RESERVED_TARGET_NAMES.has(name)) {
    throw new Error("'dev' is the project's own connection and cannot be redefined here")
  }
  if (!input.connectionId) throw new Error('A connection is required')
  return name
}

export async function createProjectTarget(input: ProjectTargetInput) {
  const userId = await getCurrentUserId()
  const name = validateProjectTarget(input)
  await ensureProjectOwnership(input.projectId, userId)
  // Without this a user could point their prod target at someone else's warehouse.
  await ensureOwnership('connection', input.connectionId, userId)

  const created = await db.projectTarget.create({
    data: { projectId: input.projectId, name, connectionId: input.connectionId },
  })
  revalidatePath('/develop')
  return created
}

export async function updateProjectTarget(id: string, input: ProjectTargetInput) {
  const userId = await getCurrentUserId()
  const name = validateProjectTarget(input)
  const existing = await db.projectTarget.findUnique({ where: { id } })
  if (!existing) throw new Error('Not found or not authorized')
  await ensureProjectOwnership(existing.projectId, userId)
  await ensureOwnership('connection', input.connectionId, userId)

  const updated = await db.projectTarget.update({
    where: { id },
    data: { name, connectionId: input.connectionId },
  })
  revalidatePath('/develop')
  return updated
}

export async function deleteProjectTarget(id: string) {
  const userId = await getCurrentUserId()
  const existing = await db.projectTarget.findUnique({ where: { id } })
  if (!existing) throw new Error('Not found or not authorized')
  await ensureProjectOwnership(existing.projectId, userId)
  await db.projectTarget.delete({ where: { id } })
  revalidatePath('/develop')
}
