export interface BillingPlan {
    id: string;
    name: string;
    tier: 'starter' | 'pro' | 'enterprise';
    maxProjects: number;
    maxRunsPerDay: number;
    concurrentSlots: number;
}

export interface BillingUsage {
    currentProjects: number;
    runsToday: number;
    plan: BillingPlan;
}

export const defaultPlan: BillingPlan = {
    id: 'community',
    name: 'Community Open-Source',
    tier: 'starter',
    maxProjects: 100,
    maxRunsPerDay: 10000,
    concurrentSlots: 4,
};

export const billingApi = {
    async getUsage(): Promise<BillingUsage> {
        return {
            currentProjects: 1,
            runsToday: 12,
            plan: defaultPlan,
        };
    },
};

export function useBilling() {
    return {
        plan: defaultPlan,
        isPro: true,
        canRunJob: true,
    };
}
