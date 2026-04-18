export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  onAttemptFailed?: (attempt: number, err: unknown) => void;
}

export interface RetryableFetchOptions extends RetryOptions {
  label?: string;
}

const DEFAULTS: Required<Pick<RetryOptions, "retries" | "baseMs" | "maxMs">> = {
  retries: 3,
  baseMs: 500,
  maxMs: 8000,
};

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? DEFAULTS.retries;
  const baseMs = opts.baseMs ?? DEFAULTS.baseMs;
  const maxMs = opts.maxMs ?? DEFAULTS.maxMs;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt > retries) throw err;
      opts.onAttemptFailed?.(attempt, err);
      const wait = computeBackoff(err, attempt, baseMs, maxMs);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit | undefined,
  opts: RetryableFetchOptions = {},
): Promise<Response> {
  const label = opts.label ?? new URL(input.toString()).pathname;
  return withRetry(async (attempt) => {
    const res = await fetch(input, init);
    if (isRetriableStatus(res.status) && attempt <= (opts.retries ?? DEFAULTS.retries)) {
      throw new TransientResponseError(res, label);
    }
    return res;
  }, opts);
}

export class TransientResponseError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(res: Response, label: string) {
    const retryAfter = res.headers.get("retry-after");
    super(`transient ${res.status} on ${label}`);
    this.name = "TransientResponseError";
    this.status = res.status;
    this.retryAfterSeconds = parseRetryAfter(retryAfter);
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof TransientResponseError) return true;
  if (err instanceof TypeError) return true;
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "ECONNREFUSED"
    ) {
      return true;
    }
  }
  return false;
}

function isRetriableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

function computeBackoff(
  err: unknown,
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  if (err instanceof TransientResponseError && err.retryAfterSeconds !== undefined) {
    return Math.min(err.retryAfterSeconds * 1000, maxMs);
  }
  const expo = baseMs * 2 ** (attempt - 1);
  const jitter = Math.random() * baseMs;
  return Math.min(expo + jitter, maxMs);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    const delta = (date - Date.now()) / 1000;
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
