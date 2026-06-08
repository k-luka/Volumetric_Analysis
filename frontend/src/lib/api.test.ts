import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAtlasRegions } from "./api";
import { SEG_MAX_LABEL } from "./segLut";

// Build a minimal Response-like object for the stubbed fetch. Only the bits
// request() touches (ok, status, statusText, text, json) are provided.
function fakeResponse(opts: {
  ok: boolean;
  status?: number;
  statusText?: string;
  body: string;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    statusText: opts.statusText ?? "",
    text: async () => opts.body,
    json: async () => JSON.parse(opts.body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.getAtlasRegions", () => {
  it("hits /api/atlas/regions and returns the parsed {maxLabel, regions}", async () => {
    const payload = {
      maxLabel: 2035,
      regions: [{ key: "hippocampus", name: "Hippocampus", group: "Medial temporal", labels: [17, 53] }],
    };
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, body: JSON.stringify(payload) }));

    const result = await getAtlasRegions();

    // The boundary URL is part of the contract with the backend.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/atlas/regions");
    // Response shape is forwarded verbatim.
    expect(result).toEqual(payload);
  });

  it("served maxLabel matches the frontend SEG_MAX_LABEL contract", async () => {
    // The backend serves structures.MAX_LABEL as maxLabel; if it ever diverged
    // from SEG_MAX_LABEL the recolor LUT would be the wrong length (black holes).
    // The backend value is pinned at 2035 in test_web/test_structures; here we
    // assert the frontend constant the viewer sizes its LUT with is the same.
    expect(SEG_MAX_LABEL).toBe(2035);

    const payload = { maxLabel: SEG_MAX_LABEL, regions: [] };
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, body: JSON.stringify(payload) }));

    const result = await getAtlasRegions();
    expect(result.maxLabel).toBe(SEG_MAX_LABEL);
  });

  it("throws the JSON `detail` message on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 500, body: JSON.stringify({ detail: "atlas unavailable" }) }),
    );

    await expect(getAtlasRegions()).rejects.toThrow("atlas unavailable");
  });

  it("falls back to the plain response text when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 502, statusText: "Bad Gateway", body: "upstream exploded" }),
    );

    await expect(getAtlasRegions()).rejects.toThrow("upstream exploded");
  });

  it("falls back to status text when the error body is empty", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 503, statusText: "Service Unavailable", body: "" }),
    );

    await expect(getAtlasRegions()).rejects.toThrow("503 Service Unavailable");
  });
});
