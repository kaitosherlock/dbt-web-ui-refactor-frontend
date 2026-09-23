import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }))
vi.mock("next-auth/react", () => ({ getSession: getSessionMock }))

import { apiClient, apiFetch, ApiError, request } from "@/common/api/client"

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers })
}

class MemoryStorage {
    private store = new Map<string, string>()
    getItem(key: string) {
        return this.store.get(key) ?? null
    }
    setItem(key: string, value: string) {
        this.store.set(key, value)
    }
    removeItem(key: string) {
        this.store.delete(key)
    }
}

describe("common/api/client", () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        getSessionMock.mockReset()
        fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        // Force the browser-only branches (session/token handling, X-Session-ID,
        // /login redirect) to run under the node test environment.
        vi.stubGlobal("window", { location: { href: "" } })
        vi.stubGlobal("localStorage", new MemoryStorage())
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    describe("ApiError", () => {
        it("is a real Error subclass carrying status, details, url and method", () => {
            const err = new ApiError("boom", 500, { detail: "x" }, "/api/x", "POST")
            expect(err).toBeInstanceOf(Error)
            expect(err).toBeInstanceOf(ApiError)
            expect(err.message).toBe("boom")
            expect(err.status).toBe(500)
            expect(err.details).toEqual({ detail: "x" })
            expect(err.url).toBe("/api/x")
            expect(err.method).toBe("POST")
        })
    })

    describe("request() error normalization", () => {
        it("extracts a string FastAPI `detail`", async () => {
            getSessionMock.mockResolvedValue(null)
            fetchMock.mockResolvedValue(jsonResponse(404, { detail: "Model not found" }))

            await expect(request("/api/x")).rejects.toMatchObject({
                message: "Model not found",
                status: 404,
            })
        })

        it("joins a FastAPI validation-error array", async () => {
            getSessionMock.mockResolvedValue(null)
            fetchMock.mockResolvedValue(
                jsonResponse(422, { detail: [{ msg: "field required" }, { msg: "must be a string" }] })
            )

            await expect(request("/api/x")).rejects.toMatchObject({
                message: "field required; must be a string",
                status: 422,
            })
        })

        it("falls back to response text when the error body isn't JSON", async () => {
            getSessionMock.mockResolvedValue(null)
            fetchMock.mockResolvedValue(new Response("internal error", { status: 500 }))

            await expect(request("/api/x")).rejects.toMatchObject({
                message: "internal error",
                status: 500,
            })
        })

        it("rejects with a real ApiError instance", async () => {
            getSessionMock.mockResolvedValue(null)
            fetchMock.mockResolvedValue(jsonResponse(400, { error: "bad" }))

            const caught = await request("/api/x").catch((e) => e)
            expect(caught).toBeInstanceOf(Error)
            expect(caught).toBeInstanceOf(ApiError)
        })
    })

    describe("request() success path", () => {
        it("returns undefined for a 204 without parsing a body", async () => {
            getSessionMock.mockResolvedValue(null)
            fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

            await expect(request("/api/x")).resolves.toBeUndefined()
        })

        it("builds a query string from params, skipping undefined/null", async () => {
            getSessionMock.mockResolvedValue(null)
            fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

            await request("/api/x", { params: { a: 1, b: "two", c: undefined, d: null } })

            const [calledUrl] = fetchMock.mock.calls[0]
            expect(calledUrl).toBe("/api/x?a=1&b=two")
        })
    })

    describe("apiFetch (/api/* calls)", () => {
        it("attaches the bearer token when the session has one", async () => {
            getSessionMock.mockResolvedValue({ accessToken: "tok-123" })
            fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

            await apiFetch("/api/projects")

            const [, init] = fetchMock.mock.calls[0]
            expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123")
            expect((init.headers as Record<string, string>)["X-Session-ID"]).toBeUndefined()
        })

        it("never requires a token or redirects when there is no session", async () => {
            getSessionMock.mockResolvedValue(null)
            fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

            await expect(apiFetch("/api/projects")).resolves.toEqual({ ok: true })
            expect((globalThis.window as unknown as { location: { href: string } }).location.href).toBe("")
        })
    })

    describe("apiClient (dbt-runner calls)", () => {
        it("prefixes the dbt-runner base URL and attaches X-Session-ID", async () => {
            getSessionMock.mockResolvedValue({ user: { id: "u1" }, accessToken: "tok-456" })
            fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

            await apiClient.get("/dbt/compile")

            const [calledUrl, init] = fetchMock.mock.calls[0]
            expect(calledUrl).toBe("/api/dbt-runner/dbt/compile")
            expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-456")
            expect((init.headers as Record<string, string>)["X-Session-ID"]).toBeTruthy()
        })

        it("redirects to /login and throws instead of calling fetch when there's no access token", async () => {
            getSessionMock.mockResolvedValue({ user: { id: "u1" } })

            await expect(apiClient.get("/dbt/compile")).rejects.toBeInstanceOf(ApiError)
            expect(fetchMock).not.toHaveBeenCalled()
            expect((globalThis.window as unknown as { location: { href: string } }).location.href).toBe("/login")
        })

        it("redirects to /login when the session itself errored (expired refresh)", async () => {
            getSessionMock.mockResolvedValue({ error: "RefreshAccessTokenError" })

            await expect(apiClient.get("/dbt/compile")).rejects.toBeInstanceOf(ApiError)
            expect(fetchMock).not.toHaveBeenCalled()
            expect((globalThis.window as unknown as { location: { href: string } }).location.href).toBe("/login")
        })
    })
})
