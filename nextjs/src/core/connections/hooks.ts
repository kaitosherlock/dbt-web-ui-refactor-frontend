'use client';

import { useState, useEffect, useCallback } from 'react';
import { connectionsApi } from './api';
import type { WarehouseConnection, ConnectionTestResult } from './types';

export function useConnections() {
    const [connections, setConnections] = useState<WarehouseConnection[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await connectionsApi.listConnections();
            setConnections(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch connections');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    return { connections, isLoading, error, refresh: load };
}

export function useConnectionTest() {
    const [testingId, setTestingId] = useState<string | null>(null);
    const [result, setResult] = useState<ConnectionTestResult | null>(null);

    const test = useCallback(async (id: string) => {
        setTestingId(id);
        setResult(null);
        try {
            const res = await connectionsApi.testConnection(id);
            setResult(res);
            return res;
        } finally {
            setTestingId(null);
        }
    }, []);

    return { test, testingId, result, clearResult: () => setResult(null) };
}
