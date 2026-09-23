export interface UsageMetrics {
    totalRuns: number;
    activeRuns: number;
    failedRuns: number;
    duckdbMemoryMb: number;
    storageUsedBytes: number;
    modelsCount: number;
    sourcesCount: number;
}

export const usageApi = {
    async getMetrics(): Promise<UsageMetrics> {
        return {
            totalRuns: 42,
            activeRuns: 0,
            failedRuns: 2,
            duckdbMemoryMb: 256,
            storageUsedBytes: 104857600, // 100 MB
            modelsCount: 15,
            sourcesCount: 3,
        };
    },
};

export function useUsageMetrics() {
    return {
        getMetrics: usageApi.getMetrics,
    };
}
