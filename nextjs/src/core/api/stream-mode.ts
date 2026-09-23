/**
 * Server-Sent Events (SSE) Stream Reader for Job Execution & Run Logs.
 * Reusable streaming infrastructure for dbt runs, test runs, and ingest jobs.
 */

export interface RunLogPayload {
    timestamp?: string;
    line?: string;
    node_id?: string;
    level?: 'info' | 'warn' | 'error' | 'debug';
}

export interface NodeStatusPayload {
    node_id: string;
    node_name?: string;
    status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    execution_time?: number;
    error_message?: string;
}

export interface StreamEvent {
    type: 'started' | 'log' | 'node_status' | 'completed' | 'error';
    run_id?: string;
    command?: string;
    payload?: RunLogPayload | NodeStatusPayload | Record<string, unknown>;
    line?: string;
    returncode?: number;
    error?: string;
}

export interface StreamSubscriptionOptions {
    onMessage?: (event: StreamEvent) => void;
    onLog?: (line: string, payload?: RunLogPayload) => void;
    onNodeStatus?: (status: NodeStatusPayload) => void;
    onError?: (error: string) => void;
    onComplete?: (returncode: number) => void;
    signal?: AbortSignal;
}

export class StreamModeConnection {
    private controller: AbortController | null = null;
    private listeners = new Set<(event: StreamEvent) => void>();
    private isConnected = false;
    private logHistory: StreamEvent[] = [];
    private maxHistory = 5000;

    constructor(private url: string, private body?: unknown, private headers?: Record<string, string>) {}

    public subscribe(listener: (event: StreamEvent) => void): () => void {
        this.listeners.add(listener);
        // Replay history to new listener
        for (const item of this.logHistory) {
            listener(item);
        }
        return () => {
            this.listeners.delete(listener);
        };
    }

    public async start(): Promise<void> {
        if (this.isConnected) return;
        this.controller = new AbortController();

        try {
            const response = await fetch(this.url, {
                method: this.body ? 'POST' : 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    ...this.headers,
                },
                body: this.body ? JSON.stringify(this.body) : undefined,
                signal: this.controller.signal,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => 'Stream connection failed');
                throw new Error(errText || `HTTP ${response.status}`);
            }

            this.isConnected = true;
            const reader = response.body?.getReader();
            if (!reader) throw new Error('ReadableStream not supported by browser/runtime');

            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) continue;

                    let parsed: StreamEvent | null = null;

                    if (line.startsWith('data:')) {
                        const jsonStr = line.slice(5).trim();
                        try {
                            parsed = JSON.parse(jsonStr);
                        } catch {
                            parsed = { type: 'log', line: jsonStr };
                        }
                    } else if (line.startsWith('{') && line.endsWith('}')) {
                        try {
                            parsed = JSON.parse(line);
                        } catch {
                            parsed = { type: 'log', line };
                        }
                    } else {
                        parsed = { type: 'log', line };
                    }

                    if (parsed) {
                        this.appendAndEmit(parsed);
                    }
                }
            }
        } catch (error) {
            if (this.controller?.signal.aborted) return;
            const errMsg = error instanceof Error ? error.message : String(error);
            this.appendAndEmit({ type: 'error', error: errMsg });
        } finally {
            this.isConnected = false;
        }
    }

    private appendAndEmit(event: StreamEvent) {
        this.logHistory.push(event);
        if (this.logHistory.length > this.maxHistory) {
            this.logHistory.shift();
        }
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (e) {
                console.error('[StreamMode] listener error', e);
            }
        }
    }

    public stop(): void {
        if (this.controller) {
            this.controller.abort();
            this.controller = null;
        }
        this.isConnected = false;
    }

    public getHistory(): StreamEvent[] {
        return [...this.logHistory];
    }
}

/**
 * Helper to initiate a streaming run request
 */
export function createRunStream(
    endpoint: string,
    requestBody: unknown,
    options?: StreamSubscriptionOptions,
    token?: string
): StreamModeConnection {
    const headers: Record<string, string> = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const conn = new StreamModeConnection(endpoint, requestBody, headers);

    if (options) {
        conn.subscribe((event) => {
            options.onMessage?.(event);
            if (event.type === 'log') {
                options.onLog?.(event.line || '', event.payload as RunLogPayload | undefined);
            } else if (event.type === 'node_status' && event.payload) {
                options.onNodeStatus?.(event.payload as unknown as NodeStatusPayload);
            } else if (event.type === 'completed') {
                options.onComplete?.(event.returncode ?? 0);
            } else if (event.type === 'error') {
                options.onError?.(event.error || 'Unknown stream error');
            }
        });
    }

    return conn;
}
