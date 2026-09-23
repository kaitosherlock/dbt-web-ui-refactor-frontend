import { apiClient } from '../api';
import type { WarehouseConnection, ConnectionTestResult } from './types';

export const connectionsApi = {
    async listConnections(): Promise<WarehouseConnection[]> {
        const rows = await apiClient.get<Array<{
            id: string;
            name: string;
            type: string;
            host?: string | null;
            port?: number | null;
            database?: string | null;
            schema?: string | null;
            username?: string | null;
            isTested?: boolean;
            createdAt?: string;
        }>>('/api/connections');

        return (rows || []).map((r) => ({
            id: r.id,
            name: r.name,
            type: (r.type as WarehouseConnection['type']) || 'postgres',
            host: r.host,
            port: r.port,
            database: r.database,
            schema: r.schema,
            username: r.username,
            is_tested: r.isTested,
            created_at: r.createdAt,
        }));
    },

    async getConnection(id: string): Promise<WarehouseConnection | null> {
        const all = await this.listConnections();
        return all.find((c) => c.id === id) || null;
    },

    async createConnection(data: Partial<WarehouseConnection> & { password?: string }): Promise<WarehouseConnection> {
        return apiClient.post<WarehouseConnection>('/api/connections', data);
    },

    async updateConnection(id: string, data: Partial<WarehouseConnection> & { password?: string }): Promise<WarehouseConnection> {
        return apiClient.put<WarehouseConnection>(`/api/connections?id=${id}`, data);
    },

    async deleteConnection(id: string): Promise<boolean> {
        try {
            await apiClient.delete(`/api/connections?id=${id}`);
            return true;
        } catch {
            return false;
        }
    },

    async testConnection(id: string): Promise<ConnectionTestResult> {
        try {
            const start = Date.now();
            const res = await apiClient.get<{ success: boolean; message: string }>(`/api/connections/${id}/test`);
            return {
                success: res.success,
                message: res.message,
                latency_ms: Date.now() - start,
            };
        } catch (e) {
            return {
                success: false,
                message: e instanceof Error ? e.message : 'Connection test failed',
            };
        }
    },
};
