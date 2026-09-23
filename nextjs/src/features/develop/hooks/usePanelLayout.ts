import { useState } from "react"
import type { DevelopSessionState } from "../model/develop-session"

export type SidebarTabType = "files" | "git" | "history"
export type TerminalTabType = "results" | "lineage" | "compiled" | "queryPlan" | "logs"
export type QueryPanelView = "results" | "plan"

/**
 * The IDE's own chrome: which sidebar tab and panel is open, and how big.
 * Pulled out of DevelopLayout because it's pure UI state with no data
 * fetching of its own — every setter here is still called from wherever it
 * always was in DevelopLayout, unchanged; only the `useState` declarations
 * moved. Restoring and persisting these values into develop-session.ts stays
 * in DevelopLayout, since that effect also covers state this hook doesn't own
 * (query results, lineage, open tabs, ...).
 */
export function usePanelLayout(restoredSession: Partial<DevelopSessionState>) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(restoredSession.sidebarCollapsed ?? false)
  const [sidebarWidth, setSidebarWidth] = useState(restoredSession.sidebarWidth ?? 256)
  const restoredSidebarTab =
    restoredSession.sidebarTab === "git" || restoredSession.sidebarTab === "history"
      ? restoredSession.sidebarTab
      : "files"
  const [sidebarTab, setSidebarTab] = useState<SidebarTabType>(restoredSidebarTab)
  const [terminalOpen, setTerminalOpen] = useState(restoredSession.terminalOpen ?? false)
  const [terminalHeight, setTerminalHeight] = useState(restoredSession.terminalHeight ?? 250)
  const [terminalTab, setTerminalTab] = useState<TerminalTabType>(
    restoredSession.terminalTab === "queryPlan" ? "results" : restoredSession.terminalTab ?? "logs"
  )
  const [agentOpen, setAgentOpen] = useState(false)
  const [queryPanelView, setQueryPanelView] = useState<QueryPanelView>(
    restoredSession.queryPanelView ?? (restoredSession.terminalTab === "queryPlan" ? "plan" : "results")
  )

  return {
    sidebarCollapsed, setSidebarCollapsed,
    sidebarWidth, setSidebarWidth,
    sidebarTab, setSidebarTab,
    terminalOpen, setTerminalOpen,
    terminalHeight, setTerminalHeight,
    terminalTab, setTerminalTab,
    agentOpen, setAgentOpen,
    queryPanelView, setQueryPanelView,
  }
}
