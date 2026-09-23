export interface JobSchedule {
    id: string;
    name: string;
    cron: string;
    command: string;
    active: boolean;
    next_run_at?: string | null;
    last_run_at?: string | null;
    last_run_status?: 'success' | 'error' | 'running';
    project_id: string;
}

export interface CronPreview {
    valid: boolean;
    message?: string | null;
    next_runs: string[];
}
