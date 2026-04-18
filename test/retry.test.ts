import { describe, expect, test } from "bun:test";
import { fetchWithRetry, withRetry } from "../src/retry.ts";

describe("withRetry", () => {
  test("returns successful result without retrying", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 42;
    }, { retries: 3, baseMs: 1 });
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  test("retries on transient errors then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new TypeError("network down");
      return "done";
    }, { retries: 3, baseMs: 1, maxMs: 5 });
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  test("stops retrying after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new TypeError("still down");
      }, { retries: 2, baseMs: 1, maxMs: 5 }),
    ).rejects.toThrow(/still down/);
    expect(calls).toBe(3);
  });

  test("does not retry non-transient errors", async () => {
    let calls = 0;
    class ValidationError extends Error {}
    await expect(
      withRetry(async () => {
        calls++;
        throw new ValidationError("bad input");
      }, { retries: 3, baseMs: 1 }),
    ).rejects.toThrow(/bad input/);
    expect(calls).toBe(1);
  });
});

describe("fetchWithRetry", () => {
  test("retries on 503 and returns final response", async () => {
    let calls = 0;
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        calls++;
        if (calls < 2) {
          return new Response("busy", { status: 503 });
        }
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const res = await fetchWithRetry("https://example.test/x", undefined, {
        retries: 3,
        baseMs: 1,
        maxMs: 5,
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("returns 4xx responses without retrying", async () => {
    let calls = 0;
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        calls++;
        return new Response("nope", { status: 403 });
      }) as typeof fetch;

      const res = await fetchWithRetry("https://example.test/x", undefined, {
        retries: 3,
        baseMs: 1,
      });
      expect(res.status).toBe(403);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("returns final 5xx response after exhausting retries", async () => {
    let calls = 0;
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        calls++;
        return new Response("down", { status: 502 });
      }) as typeof fetch;

      const res = await fetchWithRetry("https://example.test/x", undefined, {
        retries: 2,
        baseMs: 1,
        maxMs: 5,
      });
      expect(res.status).toBe(502);
      expect(calls).toBe(3);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
