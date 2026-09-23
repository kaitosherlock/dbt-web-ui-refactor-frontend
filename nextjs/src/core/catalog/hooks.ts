'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { catalogApi } from './api';
import type { CatalogTable } from './types';

export function useCatalog(projectId?: string) {
    const [tables, setTables] = useState<CatalogTable[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!projectId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await catalogApi.getCatalog(projectId);
            setTables(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch catalog');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    return { tables, isLoading, error, refresh: load };
}

export function useCatalogSearch(tables: CatalogTable[], searchQuery: string) {
    return useMemo(() => {
        if (!searchQuery.trim()) return tables;
        const q = searchQuery.toLowerCase();
        return tables.filter(
            (t) =>
                t.name.toLowerCase().includes(q) ||
                t.schema.toLowerCase().includes(q) ||
                t.description?.toLowerCase().includes(q) ||
                t.columns.some((c) => c.name.toLowerCase().includes(q))
        );
    }, [tables, searchQuery]);
}
