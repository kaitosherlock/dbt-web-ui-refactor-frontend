import { useState } from "react"
import type { DevelopSessionState } from "../model/develop-session"

export interface QueryResultsState {
  data: Record<string, unknown>[]
  columns: string[]
  columnTypes?: Record<string, string>
  rowCount?: number
  executionTime?: number
}

export interface QueryPlanState {
  adapter: string
  model: string
  mode: "Estimated"
  plan: string
  signals: string[]
  executionTime?: number
  compiledSql?: string
}

export interface LineageNode {
  id: string
  name: string
  type: string
  schema?: string
  position?: "upstream" | "current" | "downstream"
  columns?: string[]
}

export interface LineageEdge {
  from: string
  to: string
}

export type ColumnLineage = Record<string, { column: string; table: string; expression?: string }[]>

/**
 * Everything DevelopLayout shows about running a model: `dbt show`'s rows,
 * the compiled SQL, the query plan, and the table/column lineage graphs.
 * These four are grouped because they're all "what happened when you last
 * ran or previewed this model" — restoring/persisting them into
 * develop-session.ts stays in DevelopLayout alongside the other session state
 * this hook doesn't own.
 */
export function useQueryPreviewState(restoredSession: Partial<DevelopSessionState>) {
  const [queryResults, setQueryResults] = useState<QueryResultsState>(
    restoredSession.queryResults ?? { data: [], columns: [] }
  )
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(restoredSession.queryError ?? null)

  const [compiledSQL, setCompiledSQL] = useState(restoredSession.compiledSQL ?? "")
  const [compiledLoading, setCompiledLoading] = useState(false)
  const [compiledError, setCompiledError] = useState<string | null>(restoredSession.compiledError ?? null)

  const [queryPlan, setQueryPlan] = useState<QueryPlanState>(
    restoredSession.queryPlan ?? { adapter: "", model: "", mode: "Estimated", plan: "", signals: [] }
  )
  const [queryPlanLoading, setQueryPlanLoading] = useState(false)
  const [queryPlanLoadingStage, setQueryPlanLoadingStage] = useState<string | null>(null)
  const [queryPlanError, setQueryPlanError] = useState<string | null>(restoredSession.queryPlanError ?? null)

  const [lineageNodes, setLineageNodes] = useState<LineageNode[]>(restoredSession.lineageNodes ?? [])
  const [lineageEdges, setLineageEdges] = useState<LineageEdge[]>(restoredSession.lineageEdges ?? [])
  const [lineageLoading, setLineageLoading] = useState(false)
  const [lineageError, setLineageError] = useState<string | null>(restoredSession.lineageError ?? null)
  const [columnLineage, setColumnLineage] = useState<ColumnLineage>(restoredSession.columnLineage ?? {})
  const [columnLineageError, setColumnLineageError] = useState<string | null>(restoredSession.columnLineageError ?? null)

  return {
    queryResults, setQueryResults,
    queryLoading, setQueryLoading,
    queryError, setQueryError,
    compiledSQL, setCompiledSQL,
    compiledLoading, setCompiledLoading,
    compiledError, setCompiledError,
    queryPlan, setQueryPlan,
    queryPlanLoading, setQueryPlanLoading,
    queryPlanLoadingStage, setQueryPlanLoadingStage,
    queryPlanError, setQueryPlanError,
    lineageNodes, setLineageNodes,
    lineageEdges, setLineageEdges,
    lineageLoading, setLineageLoading,
    lineageError, setLineageError,
    columnLineage, setColumnLineage,
    columnLineageError, setColumnLineageError,
  }
}
