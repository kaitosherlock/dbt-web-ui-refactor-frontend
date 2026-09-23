export interface CatalogColumn {
    name: string;
    data_type?: string | null;
    description?: string | null;
    nullable?: boolean;
    distinct_count?: number;
    sample_values?: string[];
}

export interface CatalogTable {
    id: string;
    name: string;
    schema: string;
    type: 'table' | 'view' | 'source';
    row_count?: number;
    size_bytes?: number;
    description?: string | null;
    columns: CatalogColumn[];
    created_at?: string;
    last_modified?: string;
}

export interface CatalogStats {
    totalTables: number;
    totalViews: number;
    totalColumns: number;
    storageBytes?: number;
}
