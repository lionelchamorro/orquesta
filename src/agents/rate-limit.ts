export interface RateLimitInfo {
  reset_at?: string;
  message: string;
}

const RATE_LIMIT_PATTERN = /\b429\b|too many requests|rate[-\s]?limit(?:ed|s)?|quota (?:exceeded|limit|reset)/i;

const parseEpoch = (value: string): string | undefined => {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const ms = raw > 10_000_000_000 ? raw : raw * 1000;
  return new Date(ms).toISOString();
};

const parseRetryAfter = (value: string, now: () => Date): string | undefined => {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now().getTime() + seconds * 1000).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const detectRateLimit = (text: string, now: () => Date = () => new Date()): RateLimitInfo | null => {
  if (!RATE_LIMIT_PATTERN.test(text)) return null;

  const retryAfter =
    text.match(/retry-after["':=\s]+([^"',\n\r}]+)/i)?.[1]?.trim() ??
    text.match(/retry_after["':=\s]+([^"',\n\r}]+)/i)?.[1]?.trim();
  const resetAt =
    text.match(/(?:x-ratelimit-reset(?:-[a-z-]+)?|rate_limit_reset|quota_reset_at)["':=\s]+(\d{10,13})/i)?.[1]?.trim();
  const isoReset = text.match(/(?:reset_at|quota_reset_at)["':=\s]+([0-9]{4}-[0-9]{2}-[0-9]{2}T[^"',\n\r}]+)/i)?.[1]?.trim();

  return {
    reset_at: isoReset ?? (resetAt ? parseEpoch(resetAt) : undefined) ?? (retryAfter ? parseRetryAfter(retryAfter, now) : undefined),
    message: text.trim().slice(0, 500) || "API rate limit exceeded",
  };
};

export const quotaMessage = (info: RateLimitInfo) =>
  info.reset_at
    ? `API rate limit exceeded. Quota resets at ${info.reset_at}.`
    : "API rate limit exceeded. Quota reset time was not reported.";
