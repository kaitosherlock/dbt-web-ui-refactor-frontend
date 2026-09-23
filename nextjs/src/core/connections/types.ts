export type ConnectionType =
    | 'postgres'
    | 'snowflake'
    | 'bigquery'
    | 'ducklake'
    | 'duckdb'
    | 'dremio'
    | 'oracle'
    | 'mysql'
    | 'rest';

export interface WarehouseConnection {
    id: string;
    name: string;
    type: ConnectionType;
    host?: string | null;
    port?: number | null;
    database?: string | null;
    schema?: string | null;
    username?: string | null;
    is_tested?: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface ConnectionTestResult {
    success: boolean;
    message: string;
    latency_ms?: number;
}
