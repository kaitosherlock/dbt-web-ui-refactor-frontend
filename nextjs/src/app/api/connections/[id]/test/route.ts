import { NextResponse } from 'next/server'
import { auth } from '@/server/auth/auth'
import { getDbtRunnerUrl } from '@/common/api/client'
import { getConnectionById, getDremioSourceById } from '@/features/connections/server'
import { decryptSecret } from '@/server/crypto'
import { checkLakehouse, type LakehouseMode } from '@/features/lakehouse/model/lakehouse'
import { buildConnectionTestPayload } from '@/features/connections/model/test-payload'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') ?? 'connection'

  const row =
    type === 'dremio' ? await getDremioSourceById(id) : await getConnectionById(id)
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let payload: { type: string; name: string; config: Record<string, unknown> }
  if (type === 'dremio') {
    const d = row as {
      name: string
      host: string
      port: number
      tokenEncrypted: string
      username: string
    }
    payload = {
      type: 'dremio',
      name: d.name,
      config: {
        host: d.host,
        port: d.port,
        user: d.username,
        pat: decryptSecret(d.tokenEncrypted),
      },
    }
  } else {
    const c = row as {
      name: string
      connectionType: string
      host: string
      port: number
      database: string
      username: string
      passwordEncrypted: string | null
      sslMode: string | null
      extraConfig: unknown
    }
    if (c.connectionType === 'ducklake') {
      // A lakehouse is not tested through the adapter registry: dbt never runs
      // against it, and what has to be checked is the catalog, the data path and
      // the schema, all of which only dbt-runner can validate.
      const extra = ((c.extraConfig as Record<string, unknown> | null) ?? {})
      const result = await checkLakehouse(
        {
          mode: (extra.mode as LakehouseMode) ?? 'managed',
          catalogType: extra.catalog_type as 'postgresql' | 'sqlite' | undefined,
          host: c.host,
          port: c.port,
          database: c.database,
          username: c.username,
          password: decryptSecret(c.passwordEncrypted),
          dataPath: extra.data_path as string | undefined,
          metadataSchema: extra.metadata_schema as string | undefined,
          maintained: extra.maintained as boolean | undefined,
          connectionId: id,
          probe: true,
        },
        (session as { accessToken?: string }).accessToken,
      )
      return NextResponse.json(result)
    }

    const extra = (c.extraConfig as Record<string, unknown> | null) ?? {}
    const password = c.passwordEncrypted ? decryptSecret(c.passwordEncrypted) : ''
    const secondaryEncrypted = extra.secondary_secret_encrypted as string | undefined
    const secondarySecret = secondaryEncrypted ? decryptSecret(secondaryEncrypted) : ''

    payload = buildConnectionTestPayload(c, { password, secondarySecret })
  }

  const accessToken = (session as { accessToken?: string }).accessToken
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const res = await fetch(`${getDbtRunnerUrl()}/connection/test`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({ success: false, message: 'Invalid response' }))
  return NextResponse.json(data, { status: res.ok ? 200 : 502 })
}
