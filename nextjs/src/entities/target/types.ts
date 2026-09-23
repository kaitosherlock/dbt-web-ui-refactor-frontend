export interface ProjectTargetRow {
  id: string
  projectId: string
  name: string
  connectionId: string
  connection?: { id: string; name: string; connectionType: string } | null
}
