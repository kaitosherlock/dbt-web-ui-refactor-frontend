import type { Exposure } from './types';

export const exposuresApi = {
    async listExposures(_projectId?: string): Promise<Exposure[]> {
        // Return configured downstream exposures or charts
        return [
            {
                id: 'exp.executive_overview',
                name: 'Executive KPI Dashboard',
                type: 'dashboard',
                owner_name: 'Analytics Lead',
                maturity: 'high',
                depends_on_models: ['customers', 'orders'],
                description: 'Weekly revenue, cohort retention, and customer growth trends.',
            },
            {
                id: 'exp.churn_prediction_model',
                name: 'Customer Churn Predictor',
                type: 'ml',
                owner_name: 'Data Science Team',
                maturity: 'medium',
                depends_on_models: ['customers'],
                description: 'Automated ML classification pipeline running weekly inference.',
            },
        ];
    },
};
