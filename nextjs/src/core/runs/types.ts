export type RunStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export interface RunNode {
    id: string;
    name: string;
    type?: 'model' | 'test' | 'seed' | 'snapshot';
    status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    execution_time?: number;
    error_message?: string;
}

export interface JobRun {
    id: string;
    run_id: string;
    project_id: string;
    command: string;
    status: RunStatus;
    started_at: string;
    completed_at?: string;
    duration_seconds?: number;
    triggered_by?: string;
    nodes?: RunNode[];
    logs?: string[];
    returncode?: number;
}
