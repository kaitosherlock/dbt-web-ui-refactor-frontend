'use client';

import { useState, useEffect, useCallback } from 'react';
import { testsApi } from './api';
import type { DataTest, TestSummary } from './types';

export function useTests(projectId?: string) {
    const [tests, setTests] = useState<DataTest[]>([]);
    const [summary, setSummary] = useState<TestSummary>({
        total: 0,
        passed: 0,
        failed: 0,
        warned: 0,
        errors: 0,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!projectId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await testsApi.listTests(projectId);
            setTests(data.tests);
            setSummary(data.summary);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch test results');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    return { tests, summary, isLoading, error, refresh: load };
}

export function useRunTests(projectId?: string) {
    const [isRunning, setIsRunning] = useState(false);

    const run = useCallback(
        async (select?: string) => {
            if (!projectId) return false;
            setIsRunning(true);
            try {
                const res = await testsApi.triggerTestRun(projectId, select);
                return res.success;
            } catch {
                return false;
            } finally {
                setIsRunning(false);
            }
        },
        [projectId]
    );

    return { run, isRunning };
}
