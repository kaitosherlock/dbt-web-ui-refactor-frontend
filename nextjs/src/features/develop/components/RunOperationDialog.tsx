"use client"

import React, { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Play,
  Wand2,
} from "lucide-react"
import { Button } from "@/common/ui/button"
import { Input } from "@/common/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/common/ui/dialog"
import { dbtApi, type DbtCommandResponse, type DbtMacroItem } from "../api"
import {
  buildMacroArgsPayload,
  filterMacros,
  isValidMacroName,
} from "../model/macros"

interface RunOperationDialogProps {
  open: boolean
  onClose: () => void
  projectId: string
  activeTarget: string
  availableTargets?: string[]
  onOperationComplete?: (output: string) => void
}

export function RunOperationDialog({
  open,
  onClose,
  projectId,
  activeTarget,
  availableTargets = [],
  onOperationComplete,
}: RunOperationDialogProps): React.ReactElement | null {
  const [loadingMacros, setLoadingMacros] = useState(false)
  const [macros, setMacros] = useState<DbtMacroItem[]>([])
  const [manifestStatus, setManifestStatus] = useState<string>("ready")
  const [includeInternal, setIncludeInternal] = useState(false)
  const [macroSearch, setMacroSearch] = useState("")

  // Selected macro state
  const [selectedMacroId, setSelectedMacroId] = useState<string>("")
  const [customMacroName, setCustomMacroName] = useState<string>("")
  const [isCustomMacro, setIsCustomMacro] = useState<boolean>(false)
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [target, setTarget] = useState(activeTarget || "dev")

  // Execution state
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [executionResult, setExecutionResult] = useState<DbtCommandResponse | null>(null)

  const fetchMacros = useCallback(async () => {
    if (!projectId) return
    setLoadingMacros(true)
    setError(null)
    try {
      const res = await dbtApi.listMacros(projectId, includeInternal)
      if (res.success) {
        setMacros(res.macros || [])
        setManifestStatus(res.status || "ready")
      } else {
        setMacros([])
        setManifestStatus(res.status || "missing_manifest")
      }
    } catch {
      setMacros([])
      setManifestStatus("missing_manifest")
    } finally {
      setLoadingMacros(false)
    }
  }, [projectId, includeInternal])

  useEffect(() => {
    if (open) {
      void fetchMacros()
      setExecutionResult(null)
      setError(null)
    }
  }, [open, fetchMacros])

  const filteredMacros = filterMacros(macros, macroSearch)
  const selectedMacro = macros.find((m) => m.unique_id === selectedMacroId)

  // When macro selection changes, populate default args
  useEffect(() => {
    if (selectedMacro?.signature) {
      const initial: Record<string, string> = {}
      for (const arg of selectedMacro.signature) {
        if (arg.default !== undefined && arg.default !== null) {
          initial[arg.name] =
            typeof arg.default === "object"
              ? JSON.stringify(arg.default)
              : String(arg.default)
        } else {
          initial[arg.name] = ""
        }
      }
      setArgValues(initial)
    } else {
      setArgValues({})
    }
  }, [selectedMacro])

  const handleArgChange = (name: string, value: string) => {
    setArgValues((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleRun = async () => {
    const macroName = isCustomMacro ? customMacroName.trim() : selectedMacro?.name
    if (!macroName) {
      setError("Please select or specify a macro to run")
      return
    }

    if (!isValidMacroName(macroName)) {
      setError("Invalid macro name format. Expected [package.]macro_name")
      return
    }

    setRunning(true)
    setError(null)
    setExecutionResult(null)

    try {
      const parsedArgs = buildMacroArgsPayload(argValues, selectedMacro?.signature)
      const res = await dbtApi.runOperation({
        project_id: projectId,
        macro: macroName,
        args: Object.keys(parsedArgs).length > 0 ? parsedArgs : undefined,
        target: target || undefined,
      })
      setExecutionResult(res)
      if (res.stdout && onOperationComplete) {
        onOperationComplete(res.stdout)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Macro execution failed")
    } finally {
      setRunning(false)
    }
  }

  const targetsList = Array.from(
    new Set(["dev", activeTarget, ...availableTargets].filter(Boolean))
  )

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-[#0078D4]" />
            <div>
              <DialogTitle>Run dbt Operation (Macro)</DialogTitle>
              <DialogDescription>
                Execute an operation macro defined in your project or installed packages
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {manifestStatus === "missing_manifest" && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <span className="font-semibold">Manifest not yet generated.</span>
                <p className="mt-0.5 text-amber-700">
                  Run <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">dbt compile</code> or{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono">dbt run</code> first to inspect macro signatures. You can still run any macro by typing its name below.
                </p>
              </div>
            </div>
          )}

          {/* Macro Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="macro-select" className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                Macro Name
              </label>
              <button
                type="button"
                onClick={() => {
                  setIsCustomMacro(!isCustomMacro)
                  setSelectedMacroId("")
                }}
                className="text-xs font-medium text-[#0078D4] hover:underline"
              >
                {isCustomMacro ? "Select from list" : "+ Enter custom macro name"}
              </button>
            </div>

            {!isCustomMacro ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Search available macros..."
                    value={macroSearch}
                    onChange={(e) => setMacroSearch(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeInternal}
                      onChange={(e) => setIncludeInternal(e.target.checked)}
                      className="rounded border-gray-300 text-[#0078D4]"
                    />
                    Include internal
                  </label>
                </div>

                <select
                  id="macro-select"
                  value={selectedMacroId}
                  onChange={(e) => setSelectedMacroId(e.target.value)}
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs font-mono"
                  disabled={loadingMacros || filteredMacros.length === 0}
                >
                  <option value="">
                    {loadingMacros
                      ? "Loading macros from manifest..."
                      : filteredMacros.length === 0
                      ? "No macros found in manifest"
                      : "Choose a macro to run..."}
                  </option>
                  {filteredMacros.map((m) => (
                    <option key={m.unique_id} value={m.unique_id}>
                      {m.name} ({m.package_name || "global"})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Input
                placeholder="e.g. clean_stale_models or dbt_utils.clean_stale_models"
                value={customMacroName}
                onChange={(e) => setCustomMacroName(e.target.value)}
                className="h-9 text-xs font-mono"
              />
            )}

            {selectedMacro?.description && (
              <p className="text-xs text-gray-500 italic bg-gray-50 p-2 rounded">
                {selectedMacro.description}
              </p>
            )}
          </div>

          {/* Arguments Form */}
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                Macro Arguments
              </span>
              <span className="text-[11px] text-gray-400">
                Sent as JSON via <code className="font-mono">--args</code>
              </span>
            </div>

            {selectedMacro?.signature && selectedMacro.signature.length > 0 ? (
              <div className="space-y-3">
                {selectedMacro.signature.map((arg) => (
                  <div key={arg.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor={`arg-${arg.name}`} className="font-mono font-medium text-gray-800">
                        {arg.name}
                      </label>
                      {arg.default !== undefined && (
                        <span className="text-[10px] text-gray-400">
                          default: {JSON.stringify(arg.default)}
                        </span>
                      )}
                    </div>
                    <Input
                      id={`arg-${arg.name}`}
                      value={argValues[arg.name] ?? ""}
                      onChange={(e) => handleArgChange(arg.name, e.target.value)}
                      placeholder={arg.default !== undefined ? String(arg.default) : "value"}
                      className="h-8 text-xs font-mono bg-white"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-2 text-xs text-gray-500">
                {isCustomMacro
                  ? "Custom macro: no signature detected. Macro will run without positional arguments."
                  : selectedMacro
                  ? "This macro accepts no arguments according to its manifest signature."
                  : "Select a macro above to view its arguments form."}
              </div>
            )}
          </div>

          {/* Target selection */}
          <div className="flex items-center gap-3">
            <label htmlFor="macro-target-select" className="text-xs font-medium text-gray-700">Target:</label>
            <select
              id="macro-target-select"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-mono"
            >
              {targetsList.map((tgt) => (
                <option key={tgt} value={tgt}>
                  {tgt}
                </option>
              ))}
            </select>
          </div>

          {/* Execution error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="whitespace-pre-wrap font-mono">{error}</div>
            </div>
          )}

          {/* Output log */}
          {executionResult && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                {executionResult.success ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                )}
                <span>
                  {executionResult.success ? "Operation completed successfully" : "Operation finished with errors"}
                </span>
              </div>
              <pre className="max-h-56 overflow-y-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-100 whitespace-pre-wrap">
                {executionResult.stdout || executionResult.stderr || "No output returned."}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={running}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={running || (!selectedMacroId && !customMacroName.trim())}
            className="gap-1.5"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running operation..." : "Run Operation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
