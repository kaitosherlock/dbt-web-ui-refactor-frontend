export type TestStatus = 'pass' | 'fail' | 'warn' | 'error';

export interface DataTest {
    id: string;
    name: string;
    model_name: string;
    column_name?: string | null;
    type: 'unique' | 'not_null' | 'accepted_values' | 'relationships' | 'custom';
    status: TestStatus;
    execution_time?: number;
    message?: string | null;
    failures_count?: number;
}

export interface TestSummary {
    total: number;
    passed: number;
    failed: number;
    warned: number;
    errors: number;
    duration_seconds?: number;
}
