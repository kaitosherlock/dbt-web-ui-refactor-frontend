import { apiClient } from '../api';
import type { DbtModel, CompileResult, PreviewResult, ExplainResult } from './types';

export const modelsApi = {
    async listModels(projectId: string): Promise<DbtModel[]> {
        const response = await apiClient.get<{
            models: Array<{
                name: string;
                unique_id: string;
                path: string;
                description?: string | null;
                columns?: Array<{ name: string; data_type?: string | null; description?: string | null }>;
            }>;
        }>(`/api/dbt-runner/dbt/intellisense/${projectId}`);

        return (response.models || []).map((m) => ({
            id: m.unique_id || m.name,
            name: m.name,
            unique_id: m.unique_id,
            path: m.path,
            description: m.description,
            columns: m.columns || [],
            materialization: 'table',
        }));
    },

    async getModel(projectId: string, modelPath: string): Promise<DbtModel> {
        // Read file contents
        const fileRes = await apiClient.get<{ content: string }>(
            `/api/dbt-runner/files/${projectId}?path=${encodeURIComponent(modelPath)}`
        );
        const name = modelPath.split('/').pop()?.replace(/\.sql$/, '') || modelPath;

        return {
            id: name,
            name,
            unique_id: `model.${name}`,
            path: modelPath,
            raw_sql: fileRes.content,
            columns: [],
            materialization: 'table',
        };
    },

    async saveModelSql(projectId: string, modelPath: string, content: string): Promise<boolean> {
        const res = await apiClient.post<{ success: boolean }>(`/api/dbt-runner/files/${projectId}`, {
            path: modelPath,
            content,
        });
        return res.success;
    },

    async compileModel(projectId: string, modelPath: string, target?: string): Promise<CompileResult> {
        const res = await apiClient.post<{
            success: boolean;
            model: string;
            compiled_sql: string;
            error?: string;
        }>('/api/dbt-runner/dbt/compile', {
            project_id: projectId,
            model_path: modelPath,
            target,
        });

        return {
            success: res.success,
            compiled_sql: res.compiled_sql,
            model: res.model,
            error: res.error,
        };
    },

    async previewModel(projectId: string, modelPath: string, limit = 50, target?: string): Promise<PreviewResult> {
        const res = await apiClient.post<{
            success: boolean;
            data: Record<string, unknown>[];
            columns: string[];
            column_types?: Record<string, string>;
            row_count: number;
            execution_time: number;
            error?: string;
        }>('/api/dbt-runner/dbt/preview', {
            project_id: projectId,
            model_path: modelPath,
            limit,
            target,
        });

        return {
            success: res.success,
            data: res.data || [],
            columns: res.columns || [],
            column_types: res.column_types,
            row_count: res.row_count || 0,
            execution_time: res.execution_time || 0,
            error: res.error,
        };
    },

    async explainModel(projectId: string, modelPath: string, target?: string): Promise<ExplainResult> {
        const res = await apiClient.post<{
            success: boolean;
            plan: string;
            adapter?: string;
            execution_time?: number;
            error?: string;
        }>('/api/dbt-runner/dbt/explain', {
            project_id: projectId,
            model_path: modelPath,
            target,
        });

        return {
            success: res.success,
            plan: res.plan || '',
            adapter: res.adapter,
            execution_time: res.execution_time,
            error: res.error,
        };
    },

    async formatSql(sql: string, dialect = 'duckdb'): Promise<string> {
        try {
            const res = await apiClient.post<{ formatted: boolean; sql: string }>(
                '/api/dbt-runner/dbt/format',
                { sql, dialect }
            );
            return res.formatted ? res.sql : sql;
        } catch {
            return sql;
        }
    },
};
