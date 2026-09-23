"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Filter,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react"
import { Button } from "@/common/ui/button"
import { Input } from "@/common/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/common/ui/dialog"
import { dbtApi, type DbtLsRequest, type DbtLsResponse } from "../api"
import {
  COMMON_RESOURCE_TYPES,
  countByResourceType,
  filterResources,
  type DbtLsResourceRow,
} from "../model/resources"

interface ListResourcesDialogProps {
  open: boolean
  onClose: () => void
  projectId: string
  activeTarget: string
  availableTargets?: string[]
}

const TYPE_COLORS: Record<string, string> = {
  model: "bg-blue-50 text-blue-700 border-blue-200",
  source: "bg-amber-50 text-amber-700 border-amber-200",
  seed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  snapshot: "bg-purple-50 text-purple-700 border-purple-200",
  test: "bg-slate-100 text-slate-700 border-slate-300",
  unit_test: "bg-slate-100 text-slate-700 border-slate-300",
  exposure: "bg-pink-50 text-pink-700 border-pink-200",
  metric: "bg-indigo-50 text-indigo-700 border-indigo-200",
  semantic_model: "bg-violet-50 text-violet-700 border-violet-200",
  saved_query: "bg-teal-50 text-teal-700 border-teal-200",
}

export function ListResourcesDialog({
  open,
  onClose,
  projectId,
  activeTarget,
  availableTargets = [],
}: ListResourcesDialogProps): React.ReactElement | null {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<DbtLsResourceRow[]>([])
  const [count, setCount] = useState(0)
  const [truncated, setTruncated] = useState(false)

  // Filters
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedType, setSelectedType] = useState<string>("all")
  const [target, setTarget] = useState(activeTarget || "dev")
  const [selectArg, setSelectArg] = useState("")
  const [excludeArg, setExcludeArg] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)

  const fetchResources = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)

    try {
      const request: DbtLsRequest = {
        project_id: projectId,
        target: target || undefined,
        select: selectArg.trim() || undefined,
        exclude: excludeArg.trim() || undefined,
      }
      const res: DbtLsResponse = await dbtApi.listResources(request)
      if (res.success) {
        setRows(res.rows || [])
        setCount(res.count ?? (res.rows ? res.rows.length : 0))
        setTruncated(Boolean(res.truncated))
        if (res.error) {
          setError(res.error)
        }
      } else {
        setError(res.error || "Failed to list dbt resources")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute dbt ls")
    } finally {
      setLoading(false)
    }
  }, [projectId, target, selectArg, excludeArg])

  useEffect(() => {
    if (open) {
      void fetchResources()
    }
  }, [open, fetchResources])

  const typeCounts = useMemo(() => countByResourceType(rows), [rows])
  const filteredRows = useMemo(
    () => filterResources(rows, searchQuery, selectedType),
    [rows, searchQuery, selectedType]
  )

  const targetsList = useMemo(() => {
    const set = new Set(["dev", activeTarget, ...availableTargets].filter(Boolean))
    return Array.from(set)
  }, [activeTarget, availableTargets])

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-[#0078D4]" />
              <div>
                <DialogTitle>Project Resources (dbt ls)</DialogTitle>
                <DialogDescription>
                  Discovered nodes, sources, tests, and models in this project
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchResources}
                disabled={loading}
                className="h-8 gap-1.5 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Scanning..." : "Refresh"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Top filter bar */}
        <div className="space-y-3 border-b border-gray-200 bg-gray-50/70 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by name, package, tag, path..."
                className="h-9 bg-white pl-8 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="target-select" className="text-xs font-medium text-gray-600">Target:</label>
              <select
                id="target-select"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-mono"
              >
                {targetsList.map((tgt) => (
                  <option key={tgt} value={tgt}>
                    {tgt}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="h-9 text-xs text-gray-600 hover:text-gray-900"
            >
              <Filter className="mr-1 h-3.5 w-3.5" />
              {showAdvanced ? "Hide CLI filters" : "CLI filters..."}
            </Button>
          </div>

          {/* Advanced select/exclude inputs */}
          {showAdvanced && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-xs">
              <div className="flex min-w-[200px] flex-1 items-center gap-2">
                <span className="font-mono text-gray-500">--select:</span>
                <Input
                  value={selectArg}
                  onChange={(e) => setSelectArg(e.target.value)}
                  placeholder="e.g. tag:daily, +model_name"
                  className="h-7 text-xs font-mono"
                />
              </div>
              <div className="flex min-w-[200px] flex-1 items-center gap-2">
                <span className="font-mono text-gray-500">--exclude:</span>
                <Input
                  value={excludeArg}
                  onChange={(e) => setExcludeArg(e.target.value)}
                  placeholder="e.g. tag:hourly"
                  className="h-7 text-xs font-mono"
                />
              </div>
              <Button
                size="sm"
                onClick={fetchResources}
                disabled={loading}
                className="h-7 text-xs"
              >
                Apply
              </Button>
            </div>
          )}

          {/* Resource type pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs font-medium text-gray-500 mr-1">Type:</span>
            {COMMON_RESOURCE_TYPES.map((type) => {
              const typeCount = type === "all" ? count : typeCounts[type] || 0
              if (type !== "all" && typeCount === 0) return null
              const isSelected = selectedType === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSelectedType(type)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? "bg-[#0078D4] text-white shadow-sm"
                      : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  <span className="capitalize">{type}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                      isSelected ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {typeCount}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Truncated banner */}
        {truncated && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              The project contains more resources than the display limit. Showing first {rows.length} rows. Narrow your selection using the --select filter.
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="font-mono">{error}</span>
          </div>
        )}

        {/* Table content */}
        <div className="flex-1 overflow-y-auto min-h-[300px]">
          {loading && rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-8 w-8 animate-spin text-[#0078D4]" />
              <p className="mt-2 text-sm text-gray-600">Executing dbt ls against {target}...</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Layers className="h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm font-medium text-gray-600">No matching resources found</p>
              <p className="mt-1 text-xs text-gray-400">
                {rows.length === 0
                  ? "Ensure project manifest has compiled and connection is valid."
                  : "Try clearing your search query or type filters."}
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50/95 font-semibold text-gray-600 backdrop-blur-sm">
                <tr>
                  <th className="py-2.5 pl-4 pr-2">Type</th>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Package</th>
                  <th className="px-3 py-2.5">Path</th>
                  <th className="px-3 py-2.5">Config</th>
                  <th className="py-2.5 pl-3 pr-4">Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map((row) => {
                  const typeClass =
                    TYPE_COLORS[row.resource_type] ||
                    "bg-gray-100 text-gray-700 border-gray-200"
                  return (
                    <tr
                      key={row.unique_id}
                      className="hover:bg-blue-50/30 transition-colors"
                    >
                      <td className="py-2 pl-4 pr-2 whitespace-nowrap">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize ${typeClass}`}
                        >
                          {row.resource_type}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{row.name}</div>
                        <div
                          className="truncate font-mono text-[10px] text-gray-400 max-w-[200px]"
                          title={row.unique_id}
                        >
                          {row.unique_id}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {row.package_name || "-"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="font-mono text-[11px] text-gray-600"
                          title={row.original_file_path}
                        >
                          {row.original_file_path || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.config?.materialized && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-700">
                              {row.config.materialized}
                            </span>
                          )}
                          {row.config?.schema && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                              schema: {row.config.schema}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pl-3 pr-4">
                        {Array.isArray(row.tags) && row.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.tags.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.2 text-[10px] text-blue-700"
                              >
                                <Tag className="h-2.5 w-2.5" />
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-3 text-xs text-gray-500">
          <div>
            Showing <span className="font-medium text-gray-800">{filteredRows.length}</span> of{" "}
            <span className="font-medium text-gray-800">{count}</span> resources
          </div>
          <Button variant="outline" size="sm" onClick={onClose} className="h-8">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
