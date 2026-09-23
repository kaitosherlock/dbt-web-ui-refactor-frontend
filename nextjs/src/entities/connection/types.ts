/**
 * The picker shape: enough to list and choose a connection. Used by every
 * feature that lets a user pick a warehouse (project targets, ingest sources,
 * a project's own connection). The Connections feature's own CRUD view uses a
 * heavier, feature-local shape with the full set of editable fields.
 */
export interface Connection {
  id: string;
  name: string;
  type: string;
  host?: string;
  port?: number;
  is_active: boolean;
  sourceTable: "connection" | "dremio_source";
}
