'use client';

import { useState, useEffect, useCallback } from 'react';
import { schedulesApi } from './api';
import type { JobSchedule } from './types';

export function useSchedules(projectId?: string) {
    const [schedules, setSchedules] = useState<JobSchedule[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await schedulesApi.listSchedules(projectId);
            setSchedules(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch schedules');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    return { schedules, isLoading, error, refresh: load };
}
