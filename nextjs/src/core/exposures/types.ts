export type ExposureType = 'dashboard' | 'notebook' | 'analysis' | 'ml';

export interface Exposure {
    id: string;
    name: string;
    type: ExposureType;
    owner_name?: string;
    owner_email?: string;
    url?: string;
    description?: string | null;
    maturity?: 'high' | 'medium' | 'low';
    depends_on_models: string[];
}
