import 'server-only'

import { db } from '@/server/db'
import { getCurrentUserId } from '@/server/session'
import { ensureOwnership } from '@/server/ownership'
import { revalidatePath } from 'next/cache'
import {
  type IngestSourceInput,
  validateIngestSource,
} from '@/lib/ingest-source-validation'
import { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Ingest sources
//
// An ingest source stores no credentials: it references a Connection, which
// already owns the encrypted password. Nothing here needs encryptSecret.
// ---------------------------------------------------------------------------

export async function getIngestSources(projectId?: string) {
  const userId = await getCurrentUserId()
  return db.ingestSource.findMany({
    where: { createdBy: userId, ...(projectId ? { projectId } : {}) },
    include: { sourceConnection: { select: { id: true, name: true, connectionType: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createIngestSource(input: IngestSourceInput) {
  const userId = await getCurrentUserId()
  validateIngestSource(input)
  // Both the project and the connection must belong to the caller; without this
  // a user could ingest another user's warehouse into their own project.
  await ensureOwnership('dbtProject', input.projectId, userId)
  if (input.sourceConnectionId) {
    await ensureOwnership('connection', input.sourceConnectionId, userId)
  }

  const created = await db.ingestSource.create({
    data: {
      projectId: input.projectId,
      sourceConnectionId: input.sourceConnectionId ?? null,
      sourceType: input.sourceType ?? 'sql_database',
      name: input.name.trim(),
      dataset: input.dataset,
      tables: input.tables,
      sourceConfig: (input.sourceConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      cursorField: input.cursorField?.trim() || null,
      cursorInitialValue: input.cursorInitialValue?.trim() || null,
      destination: input.destination ?? 'ducklake',
      writeDisposition: input.writeDisposition ?? 'append',
      primaryKey: input.primaryKey?.length ? input.primaryKey : undefined,
      partitionBy: input.partitionBy?.length ? input.partitionBy : undefined,
      createdBy: userId,
    },
  })
  revalidatePath('/data')
  return created
}

export async function updateIngestSource(id: string, input: IngestSourceInput) {
  const userId = await getCurrentUserId()
  validateIngestSource(input)
  await ensureOwnership('ingestSource', id, userId)
  if (input.sourceConnectionId) {
    await ensureOwnership('connection', input.sourceConnectionId, userId)
  }

  const updated = await db.ingestSource.update({
    where: { id },
    data: {
      sourceConnectionId: input.sourceConnectionId ?? null,
      sourceType: input.sourceType ?? 'sql_database',
      name: input.name.trim(),
      dataset: input.dataset,
      tables: input.tables,
      sourceConfig: (input.sourceConfig ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
      cursorField: input.cursorField?.trim() || null,
      cursorInitialValue: input.cursorInitialValue?.trim() || null,
      destination: input.destination ?? 'ducklake',
      writeDisposition: input.writeDisposition ?? 'append',
      primaryKey: input.primaryKey?.length ? input.primaryKey : undefined,
      // Cleared explicitly, not left undefined: emptying the field in the form
      // must remove the partition spec, and `undefined` means "leave as-is".
      // DbNull is SQL NULL; JsonNull would store the JSON value `null`.
      partitionBy: input.partitionBy?.length ? input.partitionBy : Prisma.DbNull,
    },
  })
  revalidatePath('/data')
  return updated
}

export async function deleteIngestSource(id: string) {
  const userId = await getCurrentUserId()
  await ensureOwnership('ingestSource', id, userId)
  await db.ingestSource.delete({ where: { id } })
  revalidatePath('/data')
}
