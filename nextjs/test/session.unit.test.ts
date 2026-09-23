import { describe, expect, it, vi } from "vitest"

const authMock = vi.hoisted(() => vi.fn())
const findUserMock = vi.hoisted(() => vi.fn())

vi.mock("@/server/auth/auth", () => ({ auth: authMock }))
vi.mock("@/server/db", () => ({
  db: { user: { findUnique: findUserMock } },
}))

import { getCurrentUserId } from "../src/server/session"

describe("server session identity", () => {
  it("rejects a valid-looking session id when its user row is gone", async () => {
    authMock.mockResolvedValue({
      user: { id: "11111111-1111-1111-1111-111111111111" },
    })
    findUserMock.mockResolvedValue(null)

    await expect(getCurrentUserId()).rejects.toThrow("Not authenticated")
    expect(findUserMock).toHaveBeenCalledWith({
      where: { id: "11111111-1111-1111-1111-111111111111" },
      select: { id: true },
    })
  })
})
