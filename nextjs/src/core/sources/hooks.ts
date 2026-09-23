'use client';

import { useState, useEffect, useCallback } from 'react';
import { sourcesApi } from './api';
import type { DataSource } from './types';

export function useSources(projectId?: string) {
    const [sources, setSources] = useState<DataSource[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await sourcesApi.listSources(projectId);
            setSources(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch data sources');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    return { sources, isLoading, error, refresh: load };
}

export function useSource(sourceId?: string) {
    const [source, setSource] = useState<DataSource | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!sourceId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await sourcesApi.getSource(sourceId);
            setSource(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch source details');
        } finally {
            setIsLoading(false);
        }
    }, [sourceId]);

    useEffect(() => {
        load();
    }, [load]);

    return { source, isLoading, error, refresh: load };
}
