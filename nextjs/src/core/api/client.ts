/**
 * Core HTTP Client
 * Unified, typed fetch client with session token injection and error handling.
 */

import { getSession } from 'next-auth/react';

export class ApiError extends Error {
    constructor(public status: number, message: string, public details?: unknown) {
        super(message);
        this.name = 'ApiError';
    }
}

export interface RequestOptions extends RequestInit {
    params?: Record<string, string | number | boolean | undefined | null>;
}

export async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers: customHeaders, ...restOptions } = options;

    let fullUrl = url;
    if (params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                searchParams.append(key, String(value));
            }
        });
        const qs = searchParams.toString();
        if (qs) {
            fullUrl += (url.includes('?') ? '&' : '?') + qs;
        }
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(customHeaders as Record<string, string>),
    };

    // Inject session token if available in client environment
    try {
        if (typeof window !== 'undefined') {
            const session = await getSession();
            if (session?.accessToken) {
                headers['Authorization'] = `Bearer ${session.accessToken}`;
            }
        }
    } catch {
        // Ignore session retrieval failures in server/test environments
    }

    const response = await fetch(fullUrl, {
        headers,
        ...restOptions,
    });

    if (!response.ok) {
        let errMessage = `HTTP ${response.status}: ${response.statusText}`;
        let details: unknown;
        try {
            const data = await response.json();
            errMessage = data.detail || data.error || data.message || errMessage;
            details = data;
        } catch {
            const text = await response.text().catch(() => '');
            if (text) errMessage = text;
        }
        throw new ApiError(response.status, errMessage, details);
    }

    if (response.status === 204) {
        return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
}

export const apiClient = {
    get: <T>(url: string, options?: RequestOptions) =>
        request<T>(url, { ...options, method: 'GET' }),

    post: <T>(url: string, body?: unknown, options?: RequestOptions) =>
        request<T>(url, {
            ...options,
            method: 'POST',
            body: body !== undefined ? JSON.stringify(body) : undefined,
        }),

    put: <T>(url: string, body?: unknown, options?: RequestOptions) =>
        request<T>(url, {
            ...options,
            method: 'PUT',
            body: body !== undefined ? JSON.stringify(body) : undefined,
        }),

    delete: <T>(url: string, options?: RequestOptions) =>
        request<T>(url, { ...options, method: 'DELETE' }),
};
