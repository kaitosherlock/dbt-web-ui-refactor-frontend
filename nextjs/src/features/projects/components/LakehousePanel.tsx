"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/common/ui/button"
import type { Connection } from "@/entities/connection"
import { filesApi } from "@/entities/file"
import { getProjectTargets, type ProjectTargetRow } from "@/entities/target"
import {
  getProjectLakehouse,
  setProjectLakehouse,
  type ProjectLakehouse,
} from "@/features/lakehouse"
import { hasLiteralLakeDatabaseLine } from "../model/lakehouseDatabaseLine"

const PROJECT_YML_PATH = "dbt_project.yml"
const DUCKDB_TYPE = "duckdb"

interface Props {
  projectId: string
  connections: Connection[]
  /** The project's own connection, i.e. target `dev`, used to tell whether
   * this project has any target that isn't dbt-duckdb. */
  activeConnectionId?: string
  disabled?: boolean
}

const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:border-[#0078D4] focus-visible:ring-1 focus-visible:ring-[#0078D4] disabled:cursor-not-allowed disabled:opacity-60"

export default function LakehousePanel({
  projectId,
  connections,
  activeConnectionId,
  disabled,
}: Props): React.ReactElement {
  const [state, setState] = useState<ProjectLakehouse | null>(null)
  const [targets, setTargets] = useState<ProjectTargetRow[]>([])
  // Read-only: only used to detect a stale literal `+database: lake` for the
  // warning banner below. dbt-runner is the single writer of this line.
  const [dbtProjectYml, setDbtProjectYml] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lakes = connections.filter((c) => c.type === "ducklake")

  const load = useCallback(() => {
    getProjectLakehouse(projectId)
      .then(setState)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load lakehouse settings"))
    getProjectTargets(projectId)
      .then(setTargets)
      .catch(() => setTargets([]))
    filesApi
      .read(projectId, PROJECT_YML_PATH)
      .then((res) => setDbtProjectYml(res.content))
      .catch(() => setDbtProjectYml(null))
  }, [projectId])

  useEffect(load, [load])

  const save = useCallback(
    async (patch: { connectionId?: string | null; buildIntoLake?: boolean }) => {
      setSaving(true)
      setError(null)
      try {
        await setProjectLakehouse(projectId, patch)
        load()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save")
      } finally {
        setSaving(false)
      }
    },
    [projectId, load],
  )

  // Every target this project runs against: `dev` (its own connection) plus
  // any project_targets row. A lakehouse or dremio_source can't back a target
  // (see TargetsPanel), so only `connections` rows count.
  const targetConnectionTypes = useMemo(() => {
    const devType = connections.find((c) => c.id === activeConnectionId)?.type
    const extraTypes = targets.map(
      (t) => t.connection?.connectionType ?? connections.find((c) => c.id === t.connectionId)?.type,
    )
    return [devType, ...extraTypes].filter((t): t is string => Boolean(t))
  }, [connections, activeConnectionId, targets])

  const hasNonDuckdbTarget = targetConnectionTypes.some((t) => t.toLowerCase() !== DUCKDB_TYPE)

  const legacyLiteralLakeLine =
    hasNonDuckdbTarget && dbtProjectYml != null && hasLiteralLakeDatabaseLine(dbtProjectYml)

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  const attached = Boolean(state.connectionId)
  const busy = Boolean(disabled) || saving

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-gray-800">Lakehouse</h3>
        <p className="text-xs text-gray-500">
          A DuckLake catalog this project reads and writes: Parquet on storage, metadata in a
          database. It is attached alongside the warehouse, not instead of it.
        </p>
        <select
          className={SELECT_CLS}
          value={state.connectionId ?? ""}
          disabled={busy}
          onChange={(e) => save({ connectionId: e.target.value || null })}
        >
          <option value="">No lakehouse</option>
          {lakes.map((lake) => (
            <option key={lake.id} value={lake.id}>
              {lake.name}
            </option>
          ))}
        </select>
        {lakes.length === 0 && (
          <p className="text-xs text-gray-500">
            No lakehouses yet — create one in Data → Connections.
          </p>
        )}
      </section>

      {attached && !state.warehouseSupportsLake && (
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-900">
            This project&apos;s warehouse cannot read a DuckLake catalog — only DuckDB can. Point the
            project at a DuckDB connection under Environments, or detach the lakehouse. Until then
            every dbt command fails while setting up the profile.
          </p>
        </div>
      )}

      {legacyLiteralLakeLine && (
        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1 space-y-2">
            <p className="text-xs text-amber-900">
              dbt_project.yml pins <code>+database: lake</code> literally, but this project has a
              target that isn&apos;t dbt-duckdb. Only dbt-duckdb can attach the DuckLake catalog, so
              every build against that target fails with &quot;Catalog &apos;lake&apos; was not
              found&quot;. Switch it to a target-conditional expression so a duckdb target still
              writes into the lake and every other target keeps its own database.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => save({ buildIntoLake: true })}
              disabled={busy}
            >
              Fix dbt_project.yml
            </Button>
          </div>
        </div>
      )}

      <section className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={state.buildIntoLake}
            disabled={busy || !attached}
            onChange={(e) => save({ buildIntoLake: e.target.checked })}
          />
          <span>
            <span className="font-medium text-gray-700">Build models into the lakehouse</span>
            <span className="block text-xs text-gray-500">
              Adds <code>+database: lake</code> to dbt_project.yml — or, when this project has a
              target that isn&apos;t dbt-duckdb, a target-conditional expression so only the duckdb
              target attaches the lake. Without it dbt reads the lake but writes its models to the
              warehouse file instead, which looks like the marts going missing.
            </span>
          </span>
        </label>
      </section>

      {attached && (
        <section className="rounded-md border border-gray-200 px-3 py-2">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 py-1 text-xs">
            <span className="text-gray-500">Mode</span>
            <span className="font-mono text-gray-800">
              {state.mode === "external" ? "external (owned elsewhere)" : "managed here"}
            </span>
            <span className="text-gray-500">Maintenance</span>
            <span className="font-mono text-gray-800">
              {state.maintained ? "run by this deployment" : "left to the lakehouse owner"}
            </span>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saving && (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </p>
      )}
      <Button variant="outline" size="sm" onClick={load} disabled={busy}>
        Refresh
      </Button>
    </div>
  )
}
