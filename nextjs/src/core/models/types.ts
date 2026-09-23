export type MaterializationType = 'table' | 'view' | 'incremental' | 'ephemeral';

export interface ModelColumn {
    name: string;
    data_type?: string | null;
    description?: string | null;
}

export interface DbtModel {
    id: string;
    name: string;
    unique_id: string;
    path: string;
    raw_sql?: string;
    compiled_sql?: string;
    materialization?: MaterializationType;
    schema?: string;
    description?: string | null;
    columns: ModelColumn[];
    tags?: string[];
    depends_on?: {
        nodes: string[];
        sources: string[];
        macros: string[];
    };
}

export interface CompileResult {
    success: boolean;
    compiled_sql: string;
    model?: string;
    error?: string;
}

export interface PreviewResult {
    success: boolean;
    data: Record<string, unknown>[];
    columns: string[];
    column_types?: Record<string, string>;
    row_count: number;
    execution_time: number;
    error?: string;
}

export interface ExplainResult {
    success: boolean;
    plan: string;
    adapter?: string;
    execution_time?: number;
    error?: string;
}
