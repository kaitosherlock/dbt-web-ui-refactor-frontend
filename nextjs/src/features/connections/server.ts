import 'server-only'

import { db } from '@/server/db'
import { encryptSecret } from '@/server/crypto'
import { getCurrentUserId } from '@/server/session'
import { ensureOwnership } from '@/server/ownership'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'

// --- Dremio Sources ---

export async function getDremioSources() {
  const userId = await getCurrentUserId()
  return db.dremioSource.findMany({
    where: { createdBy: userId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createDremioSource(data: {
  name: string
  host: string
  port: number
  username: string
  tokenEncrypted: string
  catalog?: string
  arrowFlightPort?: number
}) {
  const userId = await getCurrentUserId()
  const tokenEncrypted = encryptSecret(data.tokenEncrypted)
  return db.dremioSource.create({
    data: { ...data, tokenEncrypted, createdBy: userId },
  })
}

export async function deleteDremioSource(id: string) {
  const userId = await getCurrentUserId()
  await ensureOwnership('dremioSource', id, userId)
  await db.dremioSource.delete({ where: { id } })
  revalidatePath('/data')
}

// --- Connections ---

/**
 * `mysql` and `rest` are ingest sources, not warehouses: neither has a dbt
 * adapter, so dbt-runner refuses them as a project's connection with a message.
 * They live in the same table because a credential should be encrypted, owned
 * and rotated in exactly one place.
 */
type ConnectionTypeName =
  | 'postgresql' | 'duckdb' | 'dremio' | 'oracle' | 'spark' | 'ducklake'
  | 'mysql' | 'rest'

export async function getConnections() {
  const userId = await getCurrentUserId()
  return db.connection.findMany({
    where: { createdBy: userId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createConnection(data: {
  // A lakehouse is created with an explicit id: a managed lake's metadata
  // schema and data directory are derived from it, so dbt-runner has to be
  // asked what to store *before* the row exists.
  id?: string
  name: string
  connectionType: ConnectionTypeName
  host: string
  port: number
  database: string
  username: string
  passwordEncrypted?: string
  sslMode?: string
  extraConfig?: Prisma.InputJsonValue
}) {
  const userId = await getCurrentUserId()
  const createData = {
    ...data,
    passwordEncrypted: data.passwordEncrypted
      ? encryptSecret(data.passwordEncrypted)
      : undefined,
    createdBy: userId,
  }
  return db.connection.create({
    data: createData,
  })
}

export async function deleteConnection(id: string) {
  const userId = await getCurrentUserId()
  await ensureOwnership('connection', id, userId)
  await db.connection.delete({ where: { id } })
  revalidatePath('/data')
}

export async function getConnectionById(id: string) {
  const userId = await getCurrentUserId()
  return db.connection.findFirst({ where: { id, createdBy: userId } })
}

export async function getDremioSourceById(id: string) {
  const userId = await getCurrentUserId()
  return db.dremioSource.findFirst({ where: { id, createdBy: userId } })
}

export async function updateConnection(
  id: string,
  data: {
    connectionType?: ConnectionTypeName
    name: string
    host: string
    port: number
    database: string
    username: string
    passwordEncrypted?: string | null
    sslMode?: string | null
    extraConfig?: Prisma.InputJsonValue
  }
) {
  const userId = await getCurrentUserId()
  await ensureOwnership('connection', id, userId)
  const update: Record<string, unknown> = {
    name: data.name,
    connectionType: data.connectionType,
    host: data.host,
    port: data.port,
    database: data.database,
    username: data.username,
    sslMode: data.sslMode ?? null,
    extraConfig: data.extraConfig ?? undefined,
  }
  if (!data.connectionType) delete update.connectionType
  if (data.passwordEncrypted) update.passwordEncrypted = encryptSecret(data.passwordEncrypted)
  return db.connection.update({ where: { id }, data: update })
}

export async function updateDremioSource(
  id: string,
  data: {
    name: string
    host: string
    port: number
    username: string
    tokenEncrypted?: string | null
    catalog?: string
    arrowFlightPort?: number
  }
) {
  const userId = await getCurrentUserId()
  await ensureOwnership('dremioSource', id, userId)
  const update: Record<string, unknown> = {
    name: data.name,
    host: data.host,
    port: data.port,
    username: data.username,
    catalog: data.catalog ?? '',
    arrowFlightPort: data.arrowFlightPort ?? 32010,
  }
  if (data.tokenEncrypted) update.tokenEncrypted = encryptSecret(data.tokenEncrypted)
  return db.dremioSource.update({ where: { id }, data: update })
}
