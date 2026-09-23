"use client"

import React, { useState } from "react"
import { AlertCircle, CheckCircle, Loader2, Play, Terminal } from "lucide-react"
import { Button } from "@/common/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/common/ui/dialog"
import { dbtApi } from "@/features/develop"
import { parseDebugSummary } from "../model/debug"

interface TestProfileDialogProps {
  projectId: string
  activeTarget: string
  availableTargets?: string[]
  triggerButton?: React.ReactNode
}

export function TestProfileDialog({
  projectId,
  activeTarget,
  availableTargets = [],
  triggerButton,
}: TestProfileDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(activeTarget || "dev")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; target: string; output: string } | null>(null)

  const targetsList = Array.from(
    new Set(["dev", activeTarget, ...availableTargets].filter(Boolean))
  )

  async function runDebug() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await dbtApi.debugProject(projectId, target || undefined)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile test failed")
    } finally {
      setLoading(false)
    }
  }

  function handleOpen() {
    setOpen(true)
    setTarget(activeTarget || "dev")
    void runDebug()
  }

  const summary = result ? parseDebugSummary(result.output) : null

  return (
    <>
      {triggerButton ? (
        <span onClick={handleOpen}>{triggerButton}</span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpen}
          className="h-8 gap-1.5 text-xs"
          title="Run dbt debug to test profiles.yml and warehouse connection"
        >
          <Terminal className="h-3.5 w-3.5 text-[#0078D4]" />
          Test profile
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-[#0078D4]" />
                <div>
                  <DialogTitle>Test Profile (dbt debug)</DialogTitle>
                  <DialogDescription>
                    Validates profiles.yml configuration and warehouse connectivity
                  </DialogDescription>
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <div className="flex items-center gap-2">
                <label htmlFor="debug-target-select" className="text-xs font-medium text-gray-700">Target to test:</label>
                <select
                  id="debug-target-select"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-mono"
                  disabled={loading}
                >
                  {targetsList.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                size="sm"
                onClick={runDebug}
                disabled={loading}
                className="h-8 gap-1.5 text-xs"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {loading ? "Testing..." : "Run Test"}
              </Button>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="font-mono whitespace-pre-wrap">{error}</div>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Loader2 className="h-7 w-7 animate-spin text-[#0078D4]" />
                <p className="mt-2 text-xs font-medium">Running dbt debug on target &lsquo;{target}&rsquo;...</p>
                <p className="mt-0.5 text-[11px] text-gray-400">Verifying profile paths, credentials and warehouse connection.</p>
              </div>
            )}

            {result && (
              <div className="space-y-3">
                <div
                  className={`flex items-center justify-between rounded-lg border p-3 ${
                    result.success
                      ? "border-green-200 bg-green-50 text-green-800"
                      : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    )}
                    <div>
                      <p className="text-sm font-semibold">
                        {result.success ? "Profile test passed" : "Profile test failed"}
                      </p>
                      <p className="text-xs opacity-90">
                        Target tested: <code className="font-mono font-medium">{result.target}</code>
                        {summary?.statusText ? ` · ${summary.statusText}` : ""}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-medium text-gray-600">Output:</div>
                  <pre className="max-h-72 overflow-y-auto rounded-md bg-gray-950 p-4 font-mono text-xs text-gray-100 whitespace-pre">
                    {result.output || "No output produced."}
                  </pre>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-3">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default TestProfileDialog

