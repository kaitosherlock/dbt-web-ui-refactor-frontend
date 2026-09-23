'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { runsApi } from './api';
import type { JobRun, RunNode } from './types';
import type { StreamModeConnection } from '../api';

export function useRuns(projectId?: string) {
    const [runs, setRuns] = useState<JobRun[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await runsApi.listRuns(projectId);
            setRuns(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch runs');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        load();
    }, [load]);

    return { runs, isLoading, error, refresh: load };
}

export function useRunDetail(runId?: string) {
    const [run, setRun] = useState<JobRun | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!runId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await runsApi.getRun(runId);
            setRun(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch run details');
        } finally {
            setIsLoading(false);
        }
    }, [runId]);

    useEffect(() => {
        load();
    }, [load]);

    return { run, isLoading, error, refresh: load };
}

export function useLiveRunStream(projectId?: string) {
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [nodeStatuses, setNodeStatuses] = useState<Record<string, RunNode>>({});
    const streamRef = useRef<StreamModeConnection | null>(null);

    const executeCommand = useCallback(
        (command: string, flags?: string[]) => {
            if (!projectId) return;

            setLogs([]);
            setNodeStatuses({});
            setIsRunning(true);

            if (streamRef.current) {
                streamRef.current.stop();
            }

            streamRef.current = runsApi.connectRunStream(projectId, command, flags, {
                onLog: (line) => {
                    setLogs((prev) => [...prev, line]);
                },
                onNodeStatus: (status) => {
                    setNodeStatuses((prev) => ({
                        ...prev,
                        [status.node_id]: {
                            id: status.node_id,
                            name: status.node_name || status.node_id,
                            status: status.status,
                            execution_time: status.execution_time,
                            error_message: status.error_message,
                        },
                    }));
                },
                onComplete: () => {
                    setIsRunning(false);
                },
                onError: (err) => {
                    setLogs((prev) => [...prev, `[ERROR] ${err}`]);
                    setIsRunning(false);
                },
            });
        },
        [projectId]
    );

    const stop = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.stop();
            streamRef.current = null;
        }
        setIsRunning(false);
    }, []);

    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.stop();
            }
        };
    }, []);

    return {
        isRunning,
        logs,
        nodeStatuses,
        executeCommand,
        stop,
        clearLogs: () => setLogs([]),
    };
}
