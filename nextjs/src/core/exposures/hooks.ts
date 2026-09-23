'use client';

import { useState, useEffect, useCallback } from 'react';
import { exposuresApi } from './api';
import type { Exposure } from './types';

export function useExposures(projectId?: string) {
    const [exposures, setExposures] = useState<Exposure[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await exposuresApi.listExposures(projectId);
            setExposures(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch exposures');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    return { exposures, isLoading, error, refresh: load };
}
