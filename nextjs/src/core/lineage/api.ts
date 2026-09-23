import { apiClient } from '../api';
import type { LineageGraphData, LineageNode, LineageEdge, ColumnLineage } from './types';

export const lineageApi = {
    async getModelLineage(projectId: string, modelPath: string): Promise<LineageGraphData> {
        try {
            const res = await apiClient.post<{
                success: boolean;
                model: string;
                table_lineage?: {
                    nodes: Array<{
                        id: string;
                        name: string;
                        type: string;
                        schema?: string;
                        position?: string;
                        columns?: string[];
                    }>;
                    edges: Array<{ from: string; to: string; fromColumn?: string; toColumn?: string }>;
                };
                column_lineage?: Record<string, Array<{ column: string; table: string; expression?: string }>>;
                error?: string;
            }>('/api/dbt-runner/dbt/lineage', {
                project_id: projectId,
                model_path: modelPath,
            });

            if (!res.table_lineage) {
                return { nodes: [], edges: [] };
            }

            const nodes: LineageNode[] = (res.table_lineage.nodes || []).map((n) => ({
                id: n.id,
                name: n.name,
                type: (n.type as LineageNode['type']) || 'model',
                schema: n.schema,
                position: n.position as LineageNode['position'],
                columns: (n.columns || []).map((c) => ({ name: c })),
            }));

            const edges: LineageEdge[] = (res.table_lineage.edges || []).map((e, idx) => ({
                id: `e-${idx}-${e.from}-${e.to}`,
                from: e.from,
                to: e.to,
                fromColumn: e.fromColumn,
                toColumn: e.toColumn,
            }));

            const columnLineage: Record<string, ColumnLineage[]> = {};
            if (res.column_lineage) {
                for (const [col, entries] of Object.entries(res.column_lineage)) {
                    columnLineage[col] = entries.map((entry) => ({
                        targetColumn: col,
                        sourceTable: entry.table,
                        sourceColumn: entry.column,
                        expression: entry.expression,
                    }));
                }
            }

            return { nodes, edges, columnLineage };
        } catch {
            return { nodes: [], edges: [] };
        }
    },

    async getFullLineage(projectId: string): Promise<LineageGraphData> {
        try {
            // Read from intellisense manifest to assemble the full graph
            const res = await apiClient.get<{
                models: Array<{
                    name: string;
                    unique_id: string;
                    path: string;
                    columns?: Array<{ name: string }>;
                    depends_on?: { nodes?: string[] };
                }>;
                sources: Array<{
                    source_name: string;
                    table_name: string;
                    unique_id: string;
                    columns?: Array<{ name: string }>;
                }>;
            }>(`/api/dbt-runner/dbt/intellisense/${projectId}`);

            const nodes: LineageNode[] = [];
            const edges: LineageEdge[] = [];

            // Add source nodes
            for (const s of res.sources || []) {
                nodes.push({
                    id: s.unique_id,
                    name: `${s.source_name}.${s.table_name}`,
                    type: 'source',
                    schema: s.source_name,
                    columns: (s.columns || []).map((c) => ({ name: c.name })),
                });
            }

            // Add model nodes & edges
            for (const m of res.models || []) {
                nodes.push({
                    id: m.unique_id,
                    name: m.name,
                    type: 'model',
                    path: m.path,
                    columns: (m.columns || []).map((c) => ({ name: c.name })),
                });

                if (m.depends_on?.nodes) {
                    for (const depId of m.depends_on.nodes) {
                        edges.push({
                            id: `e-${depId}-${m.unique_id}`,
                            from: depId,
                            to: m.unique_id,
                        });
                    }
                }
            }

            return { nodes, edges };
        } catch {
            return { nodes: [], edges: [] };
        }
    },
};
