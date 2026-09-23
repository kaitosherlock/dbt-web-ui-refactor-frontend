import { useState } from "react"
import type { DevelopSessionState } from "../model/develop-session"
import type { FileNode } from "../types"

/**
 * The file explorer's own tree state: which folders are expanded, the
 * children already fetched for them, and the assembled tree itself.
 * `fileTree` isn't session-restored (it's rebuilt from `filesApi.list` on
 * load, so restoring a stale tree would only show files that may no longer
 * exist); `expandedPaths` and `loadedChildren` are, so reopening a project
 * doesn't collapse everything the user had open.
 */
export function useFileTreeState(restoredSession: Partial<DevelopSessionState>) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(restoredSession.expandedPaths ?? []))
  const [loadedChildren, setLoadedChildren] = useState<Record<string, FileNode[]>>(restoredSession.loadedChildren ?? {})
  const [fileTree, setFileTree] = useState<FileNode[]>([])

  return {
    expandedPaths, setExpandedPaths,
    loadedChildren, setLoadedChildren,
    fileTree, setFileTree,
  }
}
