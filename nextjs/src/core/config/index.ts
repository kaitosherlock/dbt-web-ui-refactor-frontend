export interface AppConfig {
    productName: string;
    version: string;
    dbtRunnerUrl: string;
    authDisabled: boolean;
    isProduction: boolean;
}

export const appConfig: AppConfig = {
    productName: process.env.NEXT_PUBLIC_PRODUCT_NAME || 'dbt-craft',
    version: '0.1.0',
    dbtRunnerUrl: process.env.DBT_RUNNER_URL || 'http://localhost:8080',
    authDisabled: process.env.AUTH_DISABLED === 'true',
    isProduction: process.env.NODE_ENV === 'production',
};

export default appConfig;
