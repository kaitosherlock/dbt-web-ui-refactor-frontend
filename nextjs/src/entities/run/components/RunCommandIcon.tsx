import React from "react"
import {
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FileCode,
  FileText,
  List,
  Package,
  Play,
  RotateCcw,
  Search,
  Sprout,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  run: Play,
  build: Database,
  test: CheckCircle2,
  compile: FileCode,
  docs: FileText,
  deps: Package,
  clean: Trash2,
  seed: Sprout,
  snapshot: Camera,
  source_freshness: Clock,
  parse: Search,
  ls: List,
  debug: Wrench,
  run_operation: Terminal,
  retry: RotateCcw,
  clone: Copy,
}

export default function RunCommandIcon({
  command,
  className,
}: {
  command?: string | null
  className?: string
}) {
  const Icon = (command && ICONS[command.toLowerCase()]) || Terminal
  return <Icon className={className} />
}
