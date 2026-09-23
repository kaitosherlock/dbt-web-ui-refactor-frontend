export interface I18nTokens {
    models: string;
    lineage: string;
    catalog: string;
    runs: string;
    tests: string;
    sources: string;
    connections: string;
    schedules: string;
    docs: string;
    admin: string;
}

export const defaultDictionary: I18nTokens = {
    models: 'Models',
    lineage: 'Lineage DAG',
    catalog: 'Catalog Explorer',
    runs: 'Runs & Execution',
    tests: 'Data Tests',
    sources: 'Sources',
    connections: 'Connections',
    schedules: 'Schedules',
    docs: 'Documentation',
    admin: 'Admin',
};

export function t(key: keyof I18nTokens): string {
    return defaultDictionary[key] || key;
}
