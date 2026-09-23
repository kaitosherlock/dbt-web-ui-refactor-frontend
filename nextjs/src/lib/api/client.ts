/**
 * @deprecated Moved to `@/common/api/client` (docs/frontend-refactor-plan.md,
 * Phase 2). This file only re-exports it so existing imports keep working
 * while call sites are migrated one by one; it will be deleted once nothing
 * imports `@/lib/api/client` directly anymore.
 */
export {
    apiClient,
    ApiClient,
    getDbtRunnerUrl,
    getAgentUrl,
    generateUUID,
    resetSessionId,
    getCurrentSessionId,
    ApiError,
    type ApiResponse,
} from '@/common/api/client'
