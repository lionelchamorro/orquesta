import { expect, test } from "bun:test";
import { detectRateLimit } from "../agents/rate-limit";

test("detectRateLimit reads retry-after seconds", () => {
  const info = detectRateLimit("HTTP 429 Too Many Requests\nRetry-After: 60", () => new Date("2026-01-01T00:00:00.000Z"));
  expect(info?.reset_at).toBe("2026-01-01T00:01:00.000Z");
});

test("detectRateLimit reads epoch reset headers", () => {
  const info = detectRateLimit("rate limit exceeded\nx-ratelimit-reset-requests: 1767225600");
  expect(info?.reset_at).toBe("2026-01-01T00:00:00.000Z");
});

test("detectRateLimit ignores unrelated failures", () => {
  expect(detectRateLimit("process exited with code 1")).toBeNull();
});
