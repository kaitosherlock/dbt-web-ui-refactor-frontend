import { apiClient } from '../api';
import type { DbtMacro } from './types';

export const macrosApi = {
    async listMacros(projectId: string): Promise<DbtMacro[]> {
        try {
            const res = await apiClient.get<{
                macros: Array<{
                    name: string;
                    package_name?: string | null;
                    unique_id: string;
                    path: string;
                    description?: string | null;
                    arguments?: Array<Record<string, unknown>>;
                }>;
            }>(`/api/dbt-runner/dbt/intellisense/${projectId}`);

            return (res.macros || []).map((m) => ({
                id: m.unique_id || m.name,
                name: m.name,
                package_name: m.package_name,
                unique_id: m.unique_id,
                path: m.path,
                description: m.description,
                arguments: (m.arguments || []).map((arg) => ({
                    name: String(arg.name || 'arg'),
                    type: String(arg.type || 'any'),
                    description: arg.description ? String(arg.description) : undefined,
                })),
            }));
        } catch {
            return [];
        }
    },
};
