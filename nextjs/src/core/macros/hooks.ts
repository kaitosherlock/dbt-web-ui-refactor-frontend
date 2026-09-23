'use client';

import { useState, useEffect, useCallback } from 'react';
import { macrosApi } from './api';
import type { DbtMacro } from './types';

export function useMacros(projectId?: string) {
    const [macros, setMacros] = useState<DbtMacro[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!projectId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await macrosApi.listMacros(projectId);
            setMacros(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch macros');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    return { macros, isLoading, error, refresh: load };
}
