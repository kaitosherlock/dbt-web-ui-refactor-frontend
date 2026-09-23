/**
 * Shapes the IDE passes between its own components. Feature-local, unlike
 * entities/file's FileNode (the raw, one-level API response): this is the
 * assembled tree the file explorer renders, and the editor's open-tab state.
 */

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface OpenTab {
  path: string
  name: string
  content: string
  originalContent: string
  isDirty: boolean
  isDraft?: boolean
}
