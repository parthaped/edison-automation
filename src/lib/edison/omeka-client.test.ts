import { describe, expect, it, vi } from "vitest";
import { verifyOmekaPublicEndpoints } from "./omeka-client";

describe("verifyOmekaPublicEndpoints", () => {
  it("reports IIIF as not configured when endpoint checks fail", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const ok = url.includes("/api");
      return new Response(ok ? "{}" : "missing", { status: ok ? 200 : 404 });
    }) as unknown as typeof fetch;

    const result = await verifyOmekaPublicEndpoints("https://example.test", fetcher);

    expect(result.apiRoot).toBe("ok");
    expect(result.itemsEndpoint).toBe("ok");
    expect(result.itemSetsEndpoint).toBe("ok");
    expect(result.iiifPresentation).toBe("not-configured");
    expect(result.notes.join(" ")).toContain("admin credentials");
  });
});
