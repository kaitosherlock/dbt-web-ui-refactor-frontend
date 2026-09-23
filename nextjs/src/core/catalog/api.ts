import { apiClient } from '../api';
import type { CatalogTable } from './types';

export const catalogApi = {
    async getCatalog(projectId: string): Promise<CatalogTable[]> {
        const res = await apiClient.get<{
            status: string;
            models?: Array<{
                name: string;
                unique_id: string;
                path: string;
                description?: string | null;
                columns?: Array<{ name: string; data_type?: string | null; description?: string | null }>;
            }>;
            sources?: Array<{
                source_name: string;
                table_name: string;
                unique_id: string;
                description?: string | null;
                columns?: Array<{ name: string; data_type?: string | null; description?: string | null }>;
            }>;
        }>(`/api/dbt-runner/dbt/intellisense/${projectId}`);

        const tables: CatalogTable[] = [];

        for (const m of res.models || []) {
            tables.push({
                id: m.unique_id || m.name,
                name: m.name,
                schema: 'analytics',
                type: 'table',
                description: m.description,
                columns: (m.columns || []).map((c) => ({
                    name: c.name,
                    data_type: c.data_type,
                    description: c.description,
                })),
            });
        }

        for (const s of res.sources || []) {
            tables.push({
                id: s.unique_id || `${s.source_name}.${s.table_name}`,
                name: s.table_name,
                schema: s.source_name,
                type: 'source',
                description: s.description,
                columns: (s.columns || []).map((c) => ({
                    name: c.name,
                    data_type: c.data_type,
                    description: c.description,
                })),
            });
        }

        return tables;
    },

    async getTable(projectId: string, tableId: string): Promise<CatalogTable | null> {
        const all = await this.getCatalog(projectId);
        return all.find((t) => t.id === tableId || t.name === tableId) || null;
    },
};
