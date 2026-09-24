/**
 * The one HTTP client (docs/frontend-refactor-plan.md, Phase 2).
 *
 * Merges what used to be three separate clients:
 *   - lib/api/client.ts   (`ApiClient`/`apiClient`): calls to dbt-runner, proxied
 *     through `/api/dbt-runner` in the browser. Requires a bearer token — if the
 *     session has none, or the session itself errored, it redirects to /login —
 *     and tags every request with a dbt-runner session id (`X-Session-ID`),
 *     which the intellisense/preview endpoints use to pin a warm worker.
 *   - lib/api-client.ts   (`apiFetch` + ~40 domain helpers): calls straight to
 *     this app's own `/api/*` route handlers. Those routes do their own session
 *     check (see CLAUDE.md "Auth"), so this never requires a token or redirects
 *     — under `AUTH_DISABLED=true` there may be no meaningful token at all, and
 *     that's fine.
 *   - src/core/api/client.ts (deleted, dead code): had a `params` query-string
 *     builder and 204 handling that neither live client had. Kept here.
 *
 * Both request shapes are real: dbt-runner calls need the stricter auth
 * handling, `/api/*` calls don't. `request()` below keeps that distinction
 * (`requireDbtRunnerAuth`) rather than silently applying one behaviour to both.
 *
 * The one deliberate behaviour change from merging: `ApiError` is now a real
 * `Error` subclass. Previously `apiClient.*` (dbt-runner) calls threw a plain
 * object, so every `catch (err) { err instanceof Error ? err.message : "..." }`
 * in the app (there are dozens) silently fell back to its generic message
 * instead of showing the backend's actual error. `apiFetch`-backed calls
 * already threw a real `Error`, so they're unaffected. This only makes more
 * error messages show up correctly — it never removes information.
 */

import { getSession } from 'next-auth/react'

/**
 * Where to reach dbt-runner.
 *
 * In the browser: always the Next.js proxy route, so the backend needs no
 * public exposure and the proxy can attach auth.
 *
 * On the server (the proxy itself, and SSR): the internal address. This must
 * NOT come from a browser-facing URL — inside a container `localhost` is the
 * frontend itself, which is how this silently 500s for every backend call.
 */
export function getDbtRunnerUrl(): string {
    if (typeof window !== 'undefined') {
        return '/api/dbt-runner'
    }
    return process.env.DBT_RUNNER_URL || 'http://localhost:8080'
}

// Same shape as getDbtRunnerUrl: an internal service address nobody configures.
// A deployment that does not want the assistant sets AGENT_URL empty, and the
// proxy route then answers 503, which is what hides the panel.
export function getAgentUrl(): string {
    if (typeof window !== 'undefined') {
        return '/api/agent'
    }
    return process.env.AGENT_URL ?? 'http://dsh-agent:8090'
}

// ---- dbt-runner session id (persists across tabs) ----
// dbt-runner pins a warm worker (loaded manifest, open DuckDB connection) to
// this id, so losing it mid-session means a cold reload of the next request.

const SESSION_STORAGE_KEY = 'dbt-session-id'

const getSessionStorageKey = (userId?: string | null) =>
    userId ? `${SESSION_STORAGE_KEY}:${userId}` : SESSION_STORAGE_KEY

/** Generate a UUID, with a fallback for environments without `crypto.randomUUID`. */
export function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

function getSessionId(userId?: string | null): string {
    if (typeof window === 'undefined') {
        return ''
    }
    const storageKey = getSessionStorageKey(userId)
    localStorage.removeItem(SESSION_STORAGE_KEY)
    let sessionId = localStorage.getItem(storageKey)
    if (!sessionId) {
        sessionId = generateUUID()
        localStorage.setItem(storageKey, sessionId)
    }
    return sessionId
}

export function resetSessionId(userId?: string | null): string {
    if (typeof window === 'undefined') {
        return ''
    }
    const newSessionId = generateUUID()
    localStorage.setItem(getSessionStorageKey(userId), newSessionId)
    localStorage.removeItem(SESSION_STORAGE_KEY)
    return newSessionId
}

export function getCurrentSessionId(userId?: string | null): string {
    return getSessionId(userId)
}

// ---- Errors ----

/**
 * One error shape for every failed request, everywhere in the app.
 * `status`/`details` mirror the old plain-object `ApiError`; `url`/`method`
 * are new, and only used for logging/debugging (e.g. dev console output),
 * never matched on, so adding them is safe.
 */
export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public details?: unknown,
        public url?: string,
        public method?: string,
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

export interface ApiResponse<T = unknown> {
    success: boolean
    message?: string
    data?: T
    error?: string
}

export interface RequestOptions extends RequestInit {
    params?: Record<string, string | number | boolean | undefined | null>
    /**
     * dbt-runner calls only: attach `X-Session-ID`, require a bearer token
     * (redirecting to /login if there isn't one or the session errored), and
     * read a rotated `X-Session-ID` back from the response. Never set this for
     * calls to this app's own `/api/*` routes — they check the session
     * themselves and don't use a dbt-runner session id.
     */
    requireDbtRunnerAuth?: boolean
}

function buildUrl(url: string, params?: RequestOptions['params']): string {
    if (!params) return url
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            searchParams.append(key, String(value))
        }
    })
    const qs = searchParams.toString()
    return qs ? url + (url.includes('?') ? '&' : '?') + qs : url
}

/** FastAPI details come as a string, a `{message, …}` object, or a validation array. */
export function extractDetailMessage(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined
    const detail = (data as Record<string, unknown>).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
        return detail
            .map((item) => (item as { msg?: string })?.msg)
            .filter(Boolean)
            .join('; ')
    }
    if (detail && typeof detail === 'object') {
        return (detail as { message?: string }).message
    }
    const record = data as Record<string, unknown>
    return (record.message as string) || (record.error as string) || undefined
}

export async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers: customHeaders, requireDbtRunnerAuth, ...restOptions } = options
    const fullUrl = buildUrl(url, params)

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(customHeaders as Record<string, string>),
    }

    let userId: string | undefined
    if (typeof window !== 'undefined') {
        try {
            const session = await getSession()
            userId = session?.user?.id
            if (requireDbtRunnerAuth) {
                if (session?.error) {
                    window.location.href = '/login'
                    throw new ApiError('Session expired. Please sign in again.', 401, { error: 'auth' }, fullUrl, restOptions.method)
                }
                if (!session?.accessToken) {
                    window.location.href = '/login'
                    throw new ApiError('Missing access token. Please sign in again.', 401, { error: 'auth' }, fullUrl, restOptions.method)
                }
                headers['Authorization'] = `Bearer ${session.accessToken}`
                headers['X-Session-ID'] = getSessionId(userId)
            } else if (session?.accessToken) {
                headers['Authorization'] = `Bearer ${session.accessToken}`
            }
        } catch (err) {
            if (err instanceof ApiError) throw err
            // Ignore session retrieval failures outside the browser (SSR/tests).
        }
    }

    const response = await fetch(fullUrl, { ...restOptions, headers })

    if (requireDbtRunnerAuth && typeof window !== 'undefined') {
        const serverSessionId = response.headers.get('X-Session-ID')
        if (serverSessionId) {
            localStorage.setItem(getSessionStorageKey(userId), serverSessionId)
            localStorage.removeItem(SESSION_STORAGE_KEY)
        }
    }

    if (!response.ok) {
        // Read the body as text exactly once — a Response's body stream can only
        // be consumed once, so trying `.json()` and then falling back to
        // `.text()` on failure silently returns an empty string on the fallback.
        let message = `HTTP ${response.status}: ${response.statusText}`
        let details: unknown
        const text = await response.text().catch(() => '')
        if (text) {
            try {
                const data = JSON.parse(text)
                details = data
                message = extractDetailMessage(data) || message
            } catch {
                message = text
            }
        }
        throw new ApiError(message, response.status, details, fullUrl, restOptions.method)
    }

    if (response.status === 204) {
        return undefined as unknown as T
    }
    return response.json() as Promise<T>
}

/**
 * `/api/*` calls (this app's own route handlers). Attaches the session bearer
 * token when there is one; never requires it, never redirects.
 */
export async function apiFetch<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    return request<T>(url, { ...options, requireDbtRunnerAuth: false })
}

/**
 * dbt-runner calls, addressed by path relative to `getDbtRunnerUrl()`
 * (e.g. `apiClient.post('/dbt/compile', body)`).
 */
class ApiClient {
    private request<T>(path: string, options: RequestOptions = {}): Promise<T> {
        return request<T>(`${getDbtRunnerUrl()}${path}`, { ...options, requireDbtRunnerAuth: true })
    }

    get<T>(path: string): Promise<T> {
        return this.request<T>(path, { method: 'GET' })
    }

    post<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined })
    }

    put<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined })
    }

    delete<T>(path: string): Promise<T> {
        return this.request<T>(path, { method: 'DELETE' })
    }
}

export const apiClient = new ApiClient()
export { ApiClient }
