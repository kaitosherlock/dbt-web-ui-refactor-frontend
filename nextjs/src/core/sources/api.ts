import { apiClient } from '../api';
import type { DataSource } from './types';

export const sourcesApi = {
    async listSources(projectId?: string): Promise<DataSource[]> {
        const qs = projectId ? `?projectId=${projectId}` : '';
        const rows = await apiClient.get<Array<{
            id: string;
            name: string;
            schema: string;
            sourceType: string;
            connectionId?: string | null;
            tables?: string[] | Array<{ name: string }>;
            cursorField?: string | null;
            createdAt?: string;
        }>>(`/api/sources${qs}`);

        return (rows || []).map((r) => {
            const tables = Array.isArray(r.tables)
                ? r.tables.map((t) => (typeof t === 'string' ? { name: t } : { name: t.name }))
                : [];

            return {
                id: r.id,
                name: r.name,
                source_name: r.name,
                schema_name: r.schema,
                connection_id: r.connectionId,
                source_kind: (r.sourceType as DataSource['source_kind']) || 'sql_database',
                tables,
                cursor_field: r.cursorField,
                freshness_status: 'pass',
                created_at: r.createdAt,
            };
        });
    },

    async getSource(id: string): Promise<DataSource | null> {
        const all = await this.listSources();
        return all.find((s) => s.id === id) || null;
    },

    async createSource(data: Partial<DataSource>): Promise<DataSource> {
        return apiClient.post<DataSource>('/api/sources', data);
    },

    async updateSource(id: string, data: Partial<DataSource>): Promise<DataSource> {
        return apiClient.put<DataSource>(`/api/sources?id=${id}`, data);
    },

    async deleteSource(id: string): Promise<boolean> {
        try {
            await apiClient.delete(`/api/sources?id=${id}`);
            return true;
        } catch {
            return false;
        }
    },

    async triggerIngest(sourceId: string): Promise<{ success: boolean; job_id?: string }> {
        return apiClient.post<{ success: boolean; job_id?: string }>(`/api/dbt-runner/ingest/${sourceId}/run`, {});
    },
};
