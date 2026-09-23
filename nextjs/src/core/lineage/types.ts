export type LineageNodeType = 'model' | 'source' | 'seed' | 'snapshot' | 'exposure';

export interface LineageColumn {
    name: string;
    data_type?: string | null;
    description?: string | null;
}

export interface LineageNode {
    id: string;
    name: string;
    type: LineageNodeType;
    schema?: string;
    materialization?: 'table' | 'view' | 'incremental' | 'ephemeral';
    package?: string;
    path?: string;
    columns?: LineageColumn[];
    status?: 'success' | 'running' | 'failed' | 'queued' | 'idle';
    tags?: string[];
    description?: string | null;
    position?: 'upstream' | 'current' | 'downstream';
}

export interface LineageEdge {
    id?: string;
    from: string;
    to: string;
    fromColumn?: string;
    toColumn?: string;
    transformation?: string;
}

export interface ColumnLineage {
    targetColumn: string;
    sourceTable: string;
    sourceColumn: string;
    expression?: string;
}

export interface LineageGraphData {
    nodes: LineageNode[];
    edges: LineageEdge[];
    columnLineage?: Record<string, ColumnLineage[]>;
}

export type TraceDirection = 'all' | 'upstream' | 'downstream';

export interface LineageFilter {
    search?: string;
    direction: TraceDirection;
    depth?: number;
    nodeTypes?: LineageNodeType[];
}
