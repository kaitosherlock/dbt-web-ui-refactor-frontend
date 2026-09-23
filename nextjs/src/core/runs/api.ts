import { apiClient, createRunStream, type StreamSubscriptionOptions } from '../api';
import type { JobRun } from './types';

export const runsApi = {
    async listRuns(projectId?: string): Promise<JobRun[]> {
        const qs = projectId ? `?projectId=${projectId}` : '';
        const rows = await apiClient.get<Array<{
            id: string;
            runId?: string;
            run_id?: string;
            projectId: string;
            command: string;
            status: string;
            startedAt: string;
            completedAt?: string;
            exitCode?: number;
            returncode?: number;
            logSummary?: string;
        }>>(`/api/runs${qs}`);

        return (rows || []).map((r) => ({
            id: r.id,
            run_id: r.run_id || r.runId || r.id,
            project_id: r.projectId,
            command: r.command,
            status: (r.status as JobRun['status']) || 'pending',
            started_at: r.startedAt,
            completed_at: r.completedAt,
            returncode: r.returncode ?? r.exitCode,
        }));
    },

    async getRun(runId: string): Promise<JobRun | null> {
        try {
            const r = await apiClient.get<{
                id: string;
                runId?: string;
                projectId: string;
                command: string;
                status: string;
                startedAt: string;
                completedAt?: string;
                logs?: string[];
                exitCode?: number;
            }>(`/api/runs/${runId}`);

            return {
                id: r.id,
                run_id: r.runId || r.id,
                project_id: r.projectId,
                command: r.command,
                status: (r.status as JobRun['status']) || 'pending',
                started_at: r.startedAt,
                completed_at: r.completedAt,
                logs: r.logs,
                returncode: r.exitCode,
            };
        } catch {
            return null;
        }
    },

    async startRun(projectId: string, command: string, flags?: string[]): Promise<{ id: string; run_id: string }> {
        return apiClient.post<{ id: string; run_id: string }>('/api/dbt-runner/dbt/runs', {
            project_id: projectId,
            command,
            flags,
        });
    },

    async cancelRun(runId: string): Promise<boolean> {
        try {
            await apiClient.post(`/api/runs/${runId}/cancel`, {});
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Connect to live SSE run stream for a project or run
     */
    connectRunStream(
        projectId: string,
        command: string,
        flags?: string[],
        options?: StreamSubscriptionOptions,
        token?: string
    ) {
        const url = `/api/dbt-runner/sse/dbt/command`;
        const body = {
            project_id: projectId,
            command,
            flags,
        };

        const stream = createRunStream(url, body, options, token);
        stream.start();
        return stream;
    },
};
