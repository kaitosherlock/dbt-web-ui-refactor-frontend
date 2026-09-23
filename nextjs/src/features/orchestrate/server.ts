import 'server-only'

import { db } from '@/server/db'
import { getCurrentUserId } from '@/server/session'
import { ensureOwnership, ensureProjectOwnership } from '@/server/ownership'
import { TARGET_NAME_PATTERN } from '@/server/validation'
import { isPlausibleCron } from '@/features/orchestrate/model/cron'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import type { RunCommand } from '@prisma/client'

// --- Runs ---

/* eslint-disable @typescript-eslint/no-explicit-any */
function serializeRun(run: any) {
  return {
    ...run,
    durationMs: run.durationMs == null ? null : Number(run.durationMs),
    project: run.project
      ? {
          id: run.project.id,
          name: run.project.name,
        }
      : undefined,
    artifacts: run.artifacts?.map((artifact: any) => ({
      ...artifact,
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getRuns(projectId: string) {
  const userId = await getCurrentUserId()
  const project = await db.dbtProject.findFirst({
    where: { id: projectId, createdBy: userId, deletedAt: null },
    select: { id: true },
  })
  if (!project) throw new Error('Not found or not authorized')

  const runs = await db.dbtRun.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      _count: { select: { artifacts: true } },
    },
  })
  return runs.map(serializeRun)
}

export async function getAllRunsAcrossProjects() {
  const userId = await getCurrentUserId()
  const projects = await db.dbtProject.findMany({
    where: { createdBy: userId, deletedAt: null },
    select: { id: true },
  })
  const projectIds = projects.map((p) => p.id)
  if (projectIds.length === 0) return []

  const runs = await db.dbtRun.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { artifacts: true } },
    },
  })
  return runs.map(serializeRun)
}

export type RunLogDashboardQuery = {
  projectId?: string
  status?: string
  command?: RunCommand
  search?: string
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

export async function getRunLogDashboard(input: RunLogDashboardQuery) {
  const userId = await getCurrentUserId()
  const projects = await db.dbtProject.findMany({
    where: { createdBy: userId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  const projectIds = projects.map((project) => project.id)
  const page = Math.max(1, input.page)
  const pageSize = Math.min(100, Math.max(10, input.pageSize))

  if (projectIds.length === 0) {
    return {
      items: [],
      pagination: { page, pageSize, total: 0, totalPages: 0 },
      summary: { total: 0, success: 0, error: 0, cancelled: 0, running: 0, pending: 0, averageDurationMs: null },
      facets: { projects },
    }
  }

  if (input.projectId && !projectIds.includes(input.projectId)) {
    throw new Error('Not found or not authorized')
  }

  const search = input.search?.trim()
  const matchingProjectIds = search
    ? projects
        .filter((project) => project.name.toLowerCase().includes(search.toLowerCase()))
        .map((project) => project.id)
    : []
  const dateFilter = input.from || input.to
    ? { gte: input.from, lte: input.to }
    : undefined
  const summaryWhere: Prisma.DbtRunWhereInput = {
    projectId: input.projectId || { in: projectIds },
    command: input.command,
    createdAt: dateFilter,
    ...(search
      ? {
          OR: [
            { selector: { contains: search, mode: 'insensitive' as const } },
            { errorMessage: { contains: search, mode: 'insensitive' as const } },
            { logs: { contains: search, mode: 'insensitive' as const } },
            ...(matchingProjectIds.length > 0 ? [{ projectId: { in: matchingProjectIds } }] : []),
            ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search) ? [{ id: search }] : []),
          ],
        }
      : {}),
  }
  const filteredWhere: Prisma.DbtRunWhereInput = {
    ...summaryWhere,
    status: input.status,
  }

  const [runs, total, statusGroups, durationAggregate] = await Promise.all([
    db.dbtRun.findMany({
      where: filteredWhere,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        projectId: true,
        command: true,
        selector: true,
        status: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        modelsTotal: true,
        modelsSuccess: true,
        modelsError: true,
        errorMessage: true,
        gitCommit: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
        _count: { select: { artifacts: true } },
      },
    }),
    db.dbtRun.count({ where: filteredWhere }),
    db.dbtRun.groupBy({
      by: ['status'],
      where: summaryWhere,
      _count: { _all: true },
    }),
    db.dbtRun.aggregate({
      where: { ...summaryWhere, durationMs: { not: null } },
      _avg: { durationMs: true },
    }),
  ])

  const counts = Object.fromEntries(
    statusGroups.map((group) => [group.status, group._count._all]),
  )
  const summaryTotal = statusGroups.reduce((totalRuns, group) => totalRuns + group._count._all, 0)

  return {
    items: runs.map(serializeRun),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
    summary: {
      total: summaryTotal,
      success: counts.success || 0,
      error: counts.error || 0,
      cancelled: counts.cancelled || 0,
      running: counts.running || 0,
      pending: counts.pending || 0,
      averageDurationMs: durationAggregate._avg.durationMs == null
        ? null
        : Number(durationAggregate._avg.durationMs),
    },
    facets: { projects },
  }
}

export async function getRunById(runId: string) {
  const userId = await getCurrentUserId()
  const run = await db.dbtRun.findUnique({
    where: { id: runId },
    include: {
      project: { select: { id: true, name: true, createdBy: true } },
      artifacts: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!run || run.project.createdBy !== userId) {
    throw new Error('Not found or not authorized')
  }
  return serializeRun(run)
}

// ---------------------------------------------------------------------------
// Schedules
//
// The cron expression is parsed for real by the runner (croniter). This layer
// rejects obvious junk so a typo fails while saving instead of silently never
// firing; /dbt/cron/preview is what the form uses to confirm the timing.
// ---------------------------------------------------------------------------

const RUN_COMMANDS = new Set<RunCommand>([
  'run',
  'test',
  'build',
  'compile',
  'docs',
  'deps',
  'clean',
  'seed',
  'snapshot',
  'source_freshness',
])

const MAX_SELECTOR_LENGTH = 500
// Mirrors _NAME_RE in dbt-runner/app/routers/lake.py, which is the enforcing side.
const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/

export type ScheduleInput = {
  projectId: string
  name: string
  command?: RunCommand
  selector?: string | null
  target?: string | null
  cron: string
  isActive?: boolean
  webhookUrl?: string | null
  publishSchema?: string | null
}

function validateSchedule(input: ScheduleInput) {
  const name = input.name?.trim() ?? ''
  if (!name) throw new Error('Name is required')
  if (!isPlausibleCron(input.cron)) {
    throw new Error('Cron must be 5 fields, e.g. "0 2 * * *" for 02:00 UTC daily')
  }
  const command = input.command ?? 'run'
  if (!RUN_COMMANDS.has(command)) throw new Error(`Unsupported command: ${command}`)

  const selector = input.selector?.trim() || null
  if (selector && selector.length > MAX_SELECTOR_LENGTH) {
    throw new Error(`Selector must be ${MAX_SELECTOR_LENGTH} characters or fewer`)
  }

  const target = input.target?.trim() || null
  if (target && !TARGET_NAME_PATTERN.test(target)) {
    throw new Error('Target name must be lowercase letters, digits and underscores')
  }

  // The runner re-checks this against host_guard before every delivery; this is
  // the early, legible rejection, not the security boundary.
  const webhookUrl = input.webhookUrl?.trim() || null
  if (webhookUrl && !/^https?:\/\/.+/i.test(webhookUrl)) {
    throw new Error('Webhook URL must start with http:// or https://')
  }

  // Becomes a SQL identifier and a directory name in the Iceberg warehouse, so
  // it is validated here as well as in the runner.
  const publishSchema = input.publishSchema?.trim() || null
  if (publishSchema && !SCHEMA_NAME_PATTERN.test(publishSchema)) {
    throw new Error(
      'Publish schema must start with a letter or underscore and contain only letters, digits, _ or $',
    )
  }

  return {
    name,
    command,
    selector,
    target,
    cron: input.cron.trim(),
    webhookUrl,
    publishSchema,
  }
}

export async function getSchedules(projectId?: string) {
  const userId = await getCurrentUserId()
  return db.dbtSchedule.findMany({
    where: { createdBy: userId, ...(projectId ? { projectId } : {}) },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createSchedule(input: ScheduleInput) {
  const userId = await getCurrentUserId()
  const clean = validateSchedule(input)
  await ensureProjectOwnership(input.projectId, userId)

  const created = await db.dbtSchedule.create({
    data: {
      projectId: input.projectId,
      ...clean,
      isActive: input.isActive ?? true,
      createdBy: userId,
      // Left null on purpose: the runner arms it on its first tick, which is
      // also what stops a schedule from firing the instant it is saved.
      nextRunAt: null,
    },
  })
  revalidatePath('/orchestrate')
  return created
}

export async function updateSchedule(id: string, input: ScheduleInput) {
  const userId = await getCurrentUserId()
  const clean = validateSchedule(input)
  await ensureOwnership('dbtSchedule', id, userId)
  await ensureProjectOwnership(input.projectId, userId)

  const existing = await db.dbtSchedule.findUnique({ where: { id } })
  const updated = await db.dbtSchedule.update({
    where: { id },
    data: {
      projectId: input.projectId,
      ...clean,
      isActive: input.isActive ?? true,
      // A changed cron must not keep the old due time, or the next fire is
      // computed from a schedule that no longer exists.
      nextRunAt: existing?.cron === clean.cron ? existing?.nextRunAt : null,
    },
  })
  revalidatePath('/orchestrate')
  return updated
}

export async function deleteSchedule(id: string) {
  const userId = await getCurrentUserId()
  await ensureOwnership('dbtSchedule', id, userId)
  await db.dbtSchedule.delete({ where: { id } })
  revalidatePath('/orchestrate')
}
