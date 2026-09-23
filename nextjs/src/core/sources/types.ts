export type SourceKind = 'sql_database' | 'rest_api' | 'filesystem';
export type SourceFreshness = 'pass' | 'warn' | 'error';

export interface SourceTable {
    name: string;
    description?: string | null;
    columns_count?: number;
    row_count?: number;
}

export interface DataSource {
    id: string;
    name: string;
    source_name: string;
    schema_name: string;
    connection_id?: string | null;
    source_kind: SourceKind;
    tables: SourceTable[];
    cursor_field?: string | null;
    loaded_at_field?: string | null;
    freshness_status?: SourceFreshness;
    last_loaded_at?: string | null;
    created_at?: string;
}
