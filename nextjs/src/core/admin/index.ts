import { apiClient } from '../api';

export interface AdminProject {
    id: string;
    name: string;
    description?: string | null;
    git_branch?: string;
    sync_status?: string;
    created_at?: string;
    deleted_at?: string | null;
}

export interface AdminUser {
    id: string;
    email: string;
    name?: string | null;
    role: 'admin' | 'developer' | 'viewer';
    created_at: string;
}

export const adminApi = {
    async listProjects(includeDeleted = false): Promise<AdminProject[]> {
        return apiClient.get<AdminProject[]>(`/api/projects?includeDeleted=${includeDeleted}`);
    },

    async listUsers(): Promise<AdminUser[]> {
        // Fallback / mock when user management API is enabled
        return [
            {
                id: '1',
                email: 'admin@dbtcraft.local',
                name: 'Administrator',
                role: 'admin',
                created_at: new Date().toISOString(),
            },
        ];
    },
};

export function useAdminProjects() {
    return {
        listProjects: adminApi.listProjects,
    };
}
