"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Copy,
  Layers,
  Loader2,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/common/ui/button"
import { Input } from "@/common/ui/input"
import { filesApi } from "@/entities/file"
import { dbtApi, type DbtRunStateTarget } from "../api"
import {
  type RunOptionsState,
  type VarEntry,
  MAX_VARS_BYTES,
  validateVars,
  validateSample,
  validateEventTime,
  validateSelectorName,
  parseSelectors,
} from "../model/run-options"

interface RunOptionsDialogProps {
  open: boolean
  onClose: () => void
  projectId: string
  activeTarget: string
  availableTargets: string[]
  runOptions: RunOptionsState
  onOptionsChange: (newOptions: RunOptionsState) => void
  onRunBuildModified?: (stateTarget: string) => void
  onCloneFromTarget?: (stateTarget: string, defer?: boolean, favorState?: boolean) => void
}

type TabType = "flags" | "vars" | "state"

export function RunOptionsDialog({
  open,
  onClose,
  projectId,
  activeTarget,
  availableTargets,
  runOptions,
  onOptionsChange,
  onRunBuildModified,
  onCloneFromTarget,
}: RunOptionsDialogProps): React.ReactElement | null {
  const [activeTab, setActiveTab] = useState<TabType>("flags")
  const [localOptions, setLocalOptions] = useState<RunOptionsState>(runOptions)
  const [varEntries, setVarEntries] = useState<VarEntry[]>([])
  const [availableSelectors, setAvailableSelectors] = useState<string[]>([])
  const [selectorsLoading, setSelectorsLoading] = useState(false)
  const [stateTargets, setStateTargets] = useState<DbtRunStateTarget[]>([])
  const [stateLoading, setStateLoading] = useState(false)
  const [isCustomSelector, setIsCustomSelector] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Initialize local state when dialog opens or props change
  useEffect(() => {
    if (!open) return
    setLocalOptions(runOptions)

    // Setup varEntries
    if (runOptions.varEntries && runOptions.varEntries.length > 0) {
      setVarEntries([...runOptions.varEntries])
    } else if (runOptions.vars && Object.keys(runOptions.vars).length > 0) {
      setVarEntries(
        Object.entries(runOptions.vars).map(([key, val]) => ({
          key,
          value: typeof val === "object" ? JSON.stringify(val) : String(val),
        })),
      )
    } else {
      setVarEntries([])
    }

    setValidationError(null)
  }, [open, runOptions])

  // Fetch selectors from selectors.yml
  useEffect(() => {
    if (!open) return
    let isMounted = true
    setSelectorsLoading(true)

    async function loadSelectors() {
      try {
        const fileData = await filesApi.read(projectId, "selectors.yml")
        if (isMounted && fileData?.content) {
          const names = parseSelectors(fileData.content)
          setAvailableSelectors(names)
          if (localOptions.selector_name && !names.includes(localOptions.selector_name)) {
            setIsCustomSelector(true)
          }
        }
      } catch {
        if (isMounted) setAvailableSelectors([])
      } finally {
        if (isMounted) setSelectorsLoading(false)
      }
    }

    void loadSelectors()
    return () => {
      isMounted = false
    }
  }, [open, projectId, localOptions.selector_name])

  // Fetch dbt state targets
  useEffect(() => {
    if (!open) return
    let isMounted = true
    setStateLoading(true)

    async function loadState() {
      try {
        const res = await dbtApi.listState(projectId)
        if (isMounted && res?.targets) {
          setStateTargets(res.targets)
        }
      } catch {
        if (isMounted) setStateTargets([])
      } finally {
        if (isMounted) setStateLoading(false)
      }
    }

    void loadState()
    return () => {
      isMounted = false
    }
  }, [open, projectId])

  // Compute selected state target and whether state artifacts exist
  const selectedStateTarget = localOptions.state_target || activeTarget || "dev"
  const currentTargetState = useMemo(
    () => stateTargets.find((s) => s.target === selectedStateTarget),
    [stateTargets, selectedStateTarget],
  )
  const hasStateForSelectedTarget = Boolean(currentTargetState?.manifest)

  // Vars size calculation and validation
  const varsValidation = useMemo(() => validateVars(varEntries), [varEntries])
  const varsByteSize = useMemo(() => {
    if (!varsValidation.vars) return 0
    try {
      return new TextEncoder().encode(JSON.stringify(varsValidation.vars)).length
    } catch {
      return 0
    }
  }, [varsValidation.vars])

  // Sample validation
  const sampleValidation = useMemo(
    () => validateSample(localOptions.sample),
    [localOptions.sample],
  )

  // Event time validation
  const eventTimeValidation = useMemo(
    () => validateEventTime(localOptions.event_time_start, localOptions.event_time_end),
    [localOptions.event_time_start, localOptions.event_time_end],
  )

  // Selector validation
  const selectorValidation = useMemo(
    () => validateSelectorName(localOptions.selector_name),
    [localOptions.selector_name],
  )

  if (!open) return null

  // Helpers for date inputs
  const toLocalInputValue = (iso?: string) => {
    if (!iso) return ""
    try {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ""
      const pad = (n: number) => n.toString().padStart(2, "0")
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    } catch {
      return ""
    }
  }

  const fromLocalInputValue = (val: string) => {
    if (!val) return undefined
    try {
      const d = new Date(val)
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
    } catch {
      return undefined
    }
  }

  // Vars handlers
  const handleAddVar = () => {
    setVarEntries((prev) => [...prev, { key: "", value: "" }])
  }

  const handleUpdateVar = (index: number, field: "key" | "value", val: string) => {
    setVarEntries((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: val }
      return updated
    })
  }

  const handleRemoveVar = (index: number) => {
    setVarEntries((prev) => prev.filter((_, i) => i !== index))
  }

  // Clear all options
  const handleClearAll = () => {
    const emptyState: RunOptionsState = {
      vars: undefined,
      varEntries: [],
      empty: false,
      sample: "",
      event_time_start: undefined,
      event_time_end: undefined,
      full_refresh: false,
      selector_name: "",
      state_target: activeTarget || "dev",
      defer: false,
      favor_state: false,
    }
    setLocalOptions(emptyState)
    setVarEntries([])
    setIsCustomSelector(false)
    setValidationError(null)
  }

  // Save options
  const handleApply = () => {
    if (!varsValidation.valid) {
      setValidationError(varsValidation.error || "Invalid variables")
      setActiveTab("vars")
      return
    }
    if (!sampleValidation.valid) {
      setValidationError(sampleValidation.error || "Invalid sample")
      setActiveTab("flags")
      return
    }
    if (!eventTimeValidation.valid) {
      setValidationError(eventTimeValidation.error || "Invalid event time")
      setActiveTab("flags")
      return
    }
    if (!selectorValidation.valid) {
      setValidationError(selectorValidation.error || "Invalid selector")
      setActiveTab("flags")
      return
    }

    const cleanedVarEntries = varEntries.filter((e) => e.key.trim())
    const finalOptions: RunOptionsState = {
      ...localOptions,
      vars: varsValidation.vars,
      varEntries: cleanedVarEntries.length > 0 ? cleanedVarEntries : undefined,
      sample: sampleValidation.normalized,
      event_time_start: eventTimeValidation.startIso,
      event_time_end: eventTimeValidation.endIso,
      selector_name: localOptions.selector_name?.trim() || undefined,
      state_target: selectedStateTarget,
      defer: hasStateForSelectedTarget ? localOptions.defer : false,
      favor_state: hasStateForSelectedTarget && localOptions.defer ? localOptions.favor_state : false,
    }

    onOptionsChange(finalOptions)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-[#0078D4]" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">dbt Run Options & State</h2>
              <p className="text-xs text-gray-500">
                Configure execution flags, variables, microbatch windows, and state deferral.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-5 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("flags")}
            className={`border-b-2 px-4 py-2.5 transition-colors ${
              activeTab === "flags"
                ? "border-[#0078D4] text-[#0078D4]"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            Run Flags
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("vars")}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
              activeTab === "vars"
                ? "border-[#0078D4] text-[#0078D4]"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <span>Variables</span>
            {varEntries.filter((e) => e.key.trim()).length > 0 && (
              <span className="rounded-full bg-[#0078D4]/10 px-1.5 py-0.5 text-xs font-semibold text-[#0078D4]">
                {varEntries.filter((e) => e.key.trim()).length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("state")}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
              activeTab === "state"
                ? "border-[#0078D4] text-[#0078D4]"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <span>State & Defer</span>
            {localOptions.defer && (
              <span className="h-2 w-2 rounded-full bg-emerald-600" title="Defer active" />
            )}
          </button>
        </div>

        {/* Validation error banner */}
        {validationError && (
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Tab content area */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === "flags" && (
            <div className="space-y-4">
              {/* Full refresh */}
              <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50/50">
                <input
                  type="checkbox"
                  checked={Boolean(localOptions.full_refresh)}
                  onChange={(e) =>
                    setLocalOptions((prev) => ({ ...prev, full_refresh: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0078D4] focus:ring-[#0078D4]"
                />
                <div>
                  <span className="block text-sm font-medium text-gray-800">
                    Full refresh (<code className="text-xs">--full-refresh</code>)
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Drops and recreates incremental models and seeds from scratch (supported on run, build, seed, snapshot).
                  </span>
                </div>
              </label>

              {/* Empty */}
              <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50/50">
                <input
                  type="checkbox"
                  checked={Boolean(localOptions.empty)}
                  onChange={(e) =>
                    setLocalOptions((prev) => ({ ...prev, empty: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0078D4] focus:ring-[#0078D4]"
                />
                <div>
                  <span className="block text-sm font-medium text-gray-800">
                    Empty run (<code className="text-xs">--empty</code>)
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Limits ref and source relations to zero rows to quickly validate SQL logic (supported on run and build).
                  </span>
                </div>
              </label>

              {/* Sample */}
              <div className="rounded-lg border border-gray-200 p-3">
                <label htmlFor="run-sample-input" className="block text-sm font-medium text-gray-800">
                  Sample (<code className="text-xs">--sample</code>)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    id="run-sample-input"
                    value={localOptions.sample || ""}
                    onChange={(e) =>
                      setLocalOptions((prev) => ({ ...prev, sample: e.target.value }))
                    }
                    placeholder="e.g. 3 days, 1 month, 24 hours"
                    className="h-8 text-sm"
                  />
                  {localOptions.sample && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLocalOptions((prev) => ({ ...prev, sample: "" }))}
                      className="h-8 px-2 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Format: &apos;&lt;count&gt; &lt;grain&gt;&apos; where grain is hour, day, month, or year (max 32 chars).
                </p>
                {!sampleValidation.valid && (
                  <p className="mt-1 text-xs text-red-600">{sampleValidation.error}</p>
                )}
              </div>

              {/* Event-time window */}
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-[#0078D4]" />
                  <span className="text-sm font-medium text-gray-800">
                    Microbatch event time window (<code className="text-xs">--event-time-start / end</code>)
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor="event-time-start" className="block text-xs text-gray-600">Start time</label>
                    <input
                      id="event-time-start"
                      type="datetime-local"
                      value={toLocalInputValue(localOptions.event_time_start)}
                      onChange={(e) =>
                        setLocalOptions((prev) => ({
                          ...prev,
                          event_time_start: fromLocalInputValue(e.target.value),
                        }))
                      }
                      className="mt-1 h-8 w-full rounded border border-gray-300 px-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="event-time-end" className="block text-xs text-gray-600">End time</label>
                    <input
                      id="event-time-end"
                      type="datetime-local"
                      value={toLocalInputValue(localOptions.event_time_end)}
                      onChange={(e) =>
                        setLocalOptions((prev) => ({
                          ...prev,
                          event_time_end: fromLocalInputValue(e.target.value),
                        }))
                      }
                      className="mt-1 h-8 w-full rounded border border-gray-300 px-2 text-xs"
                    />
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Used for microbatch incremental models. Both must be given together.
                </p>
                {!eventTimeValidation.valid && (
                  <p className="mt-1 text-xs text-red-600">{eventTimeValidation.error}</p>
                )}
              </div>

              {/* Selector dropdown */}
              <div className="rounded-lg border border-gray-200 p-3">
                <label htmlFor="selector-select" className="block text-sm font-medium text-gray-800">
                  Selector (<code className="text-xs">--selector</code>)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  {!isCustomSelector ? (
                    <select
                      id="selector-select"
                      value={localOptions.selector_name || ""}
                      onChange={(e) => {
                        if (e.target.value === "__custom__") {
                          setIsCustomSelector(true)
                          setLocalOptions((prev) => ({ ...prev, selector_name: "" }))
                        } else {
                          setLocalOptions((prev) => ({ ...prev, selector_name: e.target.value }))
                        }
                      }}
                      className="h-8 flex-1 rounded border border-gray-300 bg-white px-2 text-xs"
                    >
                      <option value="">None (default)</option>
                      {availableSelectors.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      <option value="__custom__">+ Custom selector name...</option>
                    </select>
                  ) : (
                    <div className="flex flex-1 items-center gap-2">
                      <Input
                        value={localOptions.selector_name || ""}
                        onChange={(e) =>
                          setLocalOptions((prev) => ({ ...prev, selector_name: e.target.value }))
                        }
                        placeholder="selector_name"
                        className="h-8 text-xs font-mono"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsCustomSelector(false)
                          setLocalOptions((prev) => ({ ...prev, selector_name: "" }))
                        }}
                        className="h-8 text-xs"
                      >
                        List
                      </Button>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {selectorsLoading
                    ? "Reading selectors.yml..."
                    : availableSelectors.length > 0
                    ? `Found ${availableSelectors.length} selector(s) in selectors.yml.`
                    : "No selectors.yml file found in project root."}
                </p>
                {!selectorValidation.valid && (
                  <p className="mt-1 text-xs text-red-600">{selectorValidation.error}</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "vars" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-900">
                    dbt Variables (<code className="text-xs">--vars</code>)
                  </h3>
                  <p className="text-xs text-gray-500">
                    Passed as key/value pairs to dbt jinja expressions (<code className="text-xs">var(&apos;key&apos;)</code>).
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs font-mono ${
                      varsByteSize > MAX_VARS_BYTES ? "font-semibold text-red-600" : "text-gray-500"
                    }`}
                  >
                    {varsByteSize.toLocaleString()} / {MAX_VARS_BYTES.toLocaleString()} bytes
                  </span>
                </div>
              </div>

              {/* Variables table */}
              <div className="rounded-lg border border-gray-200">
                <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
                  <span>KEY</span>
                  <span>VALUE</span>
                  <span className="w-8"></span>
                </div>

                {varEntries.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-500">
                    No variables defined. Click &ldquo;Add variable&rdquo; below to add one.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {varEntries.map((entry, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-2 px-3 py-2 text-xs"
                      >
                        <Input
                          value={entry.key}
                          onChange={(e) => handleUpdateVar(index, "key", e.target.value)}
                          placeholder="key"
                          className="h-7 text-xs font-mono"
                        />
                        <Input
                          value={entry.value}
                          onChange={(e) => handleUpdateVar(index, "value", e.target.value)}
                          placeholder="value (string, number, true, false, JSON)"
                          className="h-7 text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveVar(index)}
                          className="text-gray-400 hover:text-red-600"
                          title="Remove variable"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={handleAddVar} className="text-xs">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add variable
                </Button>
                {varEntries.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVarEntries([])}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    Clear all vars
                  </Button>
                )}
              </div>

              {!varsValidation.valid && (
                <p className="text-xs text-red-600">{varsValidation.error}</p>
              )}
            </div>
          )}

          {activeTab === "state" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-900">dbt State & Deferral</h3>
                <p className="text-xs text-gray-500">
                  Compare current code against server-saved state artifacts from a named target.
                </p>
              </div>

              {/* State target selector */}
              <div className="rounded-lg border border-gray-200 p-3">
                <label htmlFor="state-target-select" className="block text-xs font-medium text-gray-700">
                  State Target (<code className="text-xs">--state</code>)
                </label>
                <div className="mt-1.5 flex items-center gap-3">
                  <select
                    id="state-target-select"
                    value={selectedStateTarget}
                    onChange={(e) =>
                      setLocalOptions((prev) => ({
                        ...prev,
                        state_target: e.target.value,
                      }))
                    }
                    className="h-8 flex-1 rounded border border-gray-300 bg-white px-2 text-xs font-mono"
                  >
                    {Array.from(new Set(["dev", ...availableTargets])).map((tgt) => (
                      <option key={tgt} value={tgt}>
                        {tgt} {tgt === activeTarget ? "(active target)" : ""}
                      </option>
                    ))}
                  </select>

                  {/* Status indicator */}
                  {stateLoading ? (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking state...
                    </div>
                  ) : hasStateForSelectedTarget ? (
                    <div className="flex items-center gap-1 rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>State ready</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>No saved state</span>
                    </div>
                  )}
                </div>

                {currentTargetState && (
                  <p className="mt-1 text-xs text-gray-500">
                    Artifacts: manifest: {currentTargetState.manifest ? "yes" : "no"},{" "}
                    run_results: {currentTargetState.run_results ? "yes" : "no"}
                    {currentTargetState.updated_at &&
                      ` · updated ${new Date(currentTargetState.updated_at).toLocaleString()}`}
                  </p>
                )}
                {!hasStateForSelectedTarget && !stateLoading && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    No state artifacts exist for target &lsquo;{selectedStateTarget}&rsquo;. Run a successful build on this target to generate state.
                  </p>
                )}
              </div>

              {/* Defer checkbox */}
              <div
                title={
                  !hasStateForSelectedTarget
                    ? `No state artifacts available for target '${selectedStateTarget}'. Run a build first.`
                    : undefined
                }
              >
                <label
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    !hasStateForSelectedTarget
                      ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
                      : "border-gray-200 hover:bg-gray-50/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!hasStateForSelectedTarget}
                    checked={Boolean(localOptions.defer && hasStateForSelectedTarget)}
                    onChange={(e) =>
                      setLocalOptions((prev) => ({
                        ...prev,
                        defer: e.target.checked,
                        favor_state: e.target.checked ? prev.favor_state : false,
                      }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0078D4] focus:ring-[#0078D4] disabled:opacity-50"
                  />
                  <div>
                    <span className="block text-sm font-medium text-gray-800">
                      Defer to target &lsquo;{selectedStateTarget}&rsquo; (<code className="text-xs">--defer</code>)
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      Resolves unbuilt upstream models to relations in the &lsquo;{selectedStateTarget}&rsquo; warehouse without rebuilding them locally.
                    </span>
                  </div>
                </label>
              </div>

              {/* Favor state relations */}
              <div
                title={
                  !localOptions.defer || !hasStateForSelectedTarget
                    ? "Requires defer to be enabled first"
                    : undefined
                }
              >
                <label
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    !localOptions.defer || !hasStateForSelectedTarget
                      ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
                      : "border-gray-200 hover:bg-gray-50/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!localOptions.defer || !hasStateForSelectedTarget}
                    checked={Boolean(localOptions.favor_state && localOptions.defer)}
                    onChange={(e) =>
                      setLocalOptions((prev) => ({ ...prev, favor_state: e.target.checked }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0078D4] focus:ring-[#0078D4] disabled:opacity-50"
                  />
                  <div>
                    <span className="block text-sm font-medium text-gray-800">
                      Favor state relations (<code className="text-xs">--favor-state</code>)
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      Prefers relations in the state target even if a local version already exists.
                    </span>
                  </div>
                </label>
              </div>

              {/* Quick actions: Build modified and Clone */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  State Actions
                </span>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <div
                    title={
                      !hasStateForSelectedTarget
                        ? `Target '${selectedStateTarget}' has no state. Run a build first.`
                        : `Build modified models comparing against ${selectedStateTarget}`
                    }
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!hasStateForSelectedTarget}
                      onClick={() => {
                        if (onRunBuildModified) {
                          onRunBuildModified(selectedStateTarget)
                          onClose()
                        }
                      }}
                      className="gap-1.5 text-xs text-[#0078D4]"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Build modified (<code className="text-[10px]">state:modified+</code>)
                    </Button>
                  </div>

                  <div
                    title={
                      !hasStateForSelectedTarget
                        ? `Target '${selectedStateTarget}' has no state. Run a build first.`
                        : `Clone relations from ${selectedStateTarget}`
                    }
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!hasStateForSelectedTarget}
                      onClick={() => {
                        if (onCloneFromTarget) {
                          onCloneFromTarget(
                            selectedStateTarget,
                            localOptions.defer,
                            localOptions.favor_state,
                          )
                          onClose()
                        }
                      }}
                      className="gap-1.5 text-xs text-emerald-700"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Clone from &lsquo;{selectedStateTarget}&rsquo;
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="text-xs text-gray-500 hover:text-red-600"
          >
            Clear all options
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply} className="bg-[#0078D4] text-xs hover:bg-[#006abc]">
              Apply Options
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
