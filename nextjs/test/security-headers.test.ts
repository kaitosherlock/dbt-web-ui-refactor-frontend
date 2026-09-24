import { describe, expect, it } from "vitest";

import nextConfig, { createSecurityHeaders } from "../next.config";

describe("browser security headers", () => {
  it("sets the baseline without permissive CORS headers", () => {
    const headers = createSecurityHeaders(false);
    const values = Object.fromEntries(headers.map(({ key, value }) => [key, value]));

    expect(values["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(values["X-Content-Type-Options"]).toBe("nosniff");
    expect(values["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(values["X-Frame-Options"]).toBe("DENY");
    expect(values["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(values["Strict-Transport-Security"]).toBeUndefined();
  });

  it("configures relaxed framing headers for dbt-docs", () => {
    const headers = createSecurityHeaders(false, {
      frameAncestors: "'self'",
      xFrameOptions: "SAMEORIGIN",
    });
    const values = Object.fromEntries(headers.map(({ key, value }) => [key, value]));

    expect(values["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(values["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("adds HSTS for production", () => {
    const headers = createSecurityHeaders(true);
    const hsts = headers.find(({ key }) => key === "Strict-Transport-Security");

    expect(hsts?.value).toContain("max-age=63072000");
  });

  it("configures /api/dbt-docs/:path* with frame-ancestors 'self' and SAMEORIGIN while keeping 'none'/DENY elsewhere", async () => {
    const headersList = await nextConfig.headers?.();
    expect(headersList).toBeDefined();

    const rootConfig = headersList?.find((entry) => entry.source === "/:path*");
    expect(rootConfig).toBeDefined();
    const rootValues = Object.fromEntries(rootConfig!.headers.map(({ key, value }) => [key, value]));
    expect(rootValues["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(rootValues["X-Frame-Options"]).toBe("DENY");

    const docsConfig = headersList?.find((entry) => entry.source === "/api/dbt-docs/:path*");
    expect(docsConfig).toBeDefined();
    const docsValues = Object.fromEntries(docsConfig!.headers.map(({ key, value }) => [key, value]));
    expect(docsValues["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(docsValues["X-Frame-Options"]).toBe("SAMEORIGIN");
  });
});
