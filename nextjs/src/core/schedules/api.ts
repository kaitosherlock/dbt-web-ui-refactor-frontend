import { apiClient } from '../api';
import type { JobSchedule, CronPreview } from './types';

export const schedulesApi = {
    async listSchedules(projectId?: string): Promise<JobSchedule[]> {
        const qs = projectId ? `?projectId=${projectId}` : '';
        const rows = await apiClient.get<Array<{
            id: string;
            name: string;
            cron: string;
            command: string;
            active: boolean;
            nextRunAt?: string | null;
            lastRunAt?: string | null;
            lastRunStatus?: string;
            projectId: string;
        }>>(`/api/schedules${qs}`);

        return (rows || []).map((r) => ({
            id: r.id,
            name: r.name,
            cron: r.cron,
            command: r.command,
            active: r.active,
            next_run_at: r.nextRunAt,
            last_run_at: r.lastRunAt,
            last_run_status: r.lastRunStatus as JobSchedule['last_run_status'],
            project_id: r.projectId,
        }));
    },

    async createSchedule(data: Partial<JobSchedule>): Promise<JobSchedule> {
        return apiClient.post<JobSchedule>('/api/schedules', data);
    },

    async updateSchedule(id: string, data: Partial<JobSchedule>): Promise<JobSchedule> {
        return apiClient.put<JobSchedule>(`/api/schedules?id=${id}`, data);
    },

    async deleteSchedule(id: string): Promise<boolean> {
        try {
            await apiClient.delete(`/api/schedules?id=${id}`);
            return true;
        } catch {
            return false;
        }
    },

    async triggerSchedule(id: string): Promise<{ success: boolean; run_id?: string }> {
        return apiClient.post<{ success: boolean; run_id?: string }>(`/api/schedules/${id}/run`, {});
    },

    async previewCron(expression: string, count = 5): Promise<CronPreview> {
        try {
            const res = await apiClient.get<{ valid: boolean; message: string | null; next_runs: string[] }>(
                `/api/dbt-runner/dbt/cron/preview?expression=${encodeURIComponent(expression)}&count=${count}`
            );
            return {
                valid: res.valid,
                message: res.message,
                next_runs: res.next_runs || [],
            };
        } catch (e) {
            return {
                valid: false,
                message: e instanceof Error ? e.message : 'Invalid cron expression',
                next_runs: [],
            };
        }
    },
};
