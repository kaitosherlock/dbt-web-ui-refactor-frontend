'use client';

import { useState, useEffect, useCallback } from 'react';
import { modelsApi } from './api';
import type { DbtModel, CompileResult, PreviewResult } from './types';

export function useModelList(projectId?: string) {
    const [models, setModels] = useState<DbtModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!projectId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await modelsApi.listModels(projectId);
            setModels(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch models');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { models, isLoading, error, refresh };
}

export function useModel(projectId?: string, modelPath?: string) {
    const [model, setModel] = useState<DbtModel | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!projectId || !modelPath) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await modelsApi.getModel(projectId, modelPath);
            setModel(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load model file');
        } finally {
            setIsLoading(false);
        }
    }, [projectId, modelPath]);

    useEffect(() => {
        load();
    }, [load]);

    const saveSql = useCallback(
        async (sql: string) => {
            if (!projectId || !modelPath) return false;
            try {
                const ok = await modelsApi.saveModelSql(projectId, modelPath, sql);
                if (ok && model) {
                    setModel({ ...model, raw_sql: sql });
                }
                return ok;
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to save model SQL');
                return false;
            }
        },
        [projectId, modelPath, model]
    );

    return { model, isLoading, error, refresh: load, saveSql };
}

export function useCompilePreview(projectId?: string) {
    const [isCompiling, setIsCompiling] = useState(false);
    const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);

    const compile = useCallback(
        async (modelPath: string, target?: string) => {
            if (!projectId) return null;
            setIsCompiling(true);
            try {
                const res = await modelsApi.compileModel(projectId, modelPath, target);
                setCompileResult(res);
                return res;
            } catch (e) {
                const errResult: CompileResult = {
                    success: false,
                    compiled_sql: '',
                    error: e instanceof Error ? e.message : 'Compile failed',
                };
                setCompileResult(errResult);
                return errResult;
            } finally {
                setIsCompiling(false);
            }
        },
        [projectId]
    );

    const preview = useCallback(
        async (modelPath: string, limit = 50, target?: string) => {
            if (!projectId) return null;
            setIsPreviewing(true);
            try {
                const res = await modelsApi.previewModel(projectId, modelPath, limit, target);
                setPreviewResult(res);
                return res;
            } catch (e) {
                const errResult: PreviewResult = {
                    success: false,
                    data: [],
                    columns: [],
                    row_count: 0,
                    execution_time: 0,
                    error: e instanceof Error ? e.message : 'Preview failed',
                };
                setPreviewResult(errResult);
                return errResult;
            } finally {
                setIsPreviewing(false);
            }
        },
        [projectId]
    );

    return {
        compile,
        preview,
        isCompiling,
        isPreviewing,
        compileResult,
        previewResult,
        clearResults: () => {
            setCompileResult(null);
            setPreviewResult(null);
        },
    };
}
