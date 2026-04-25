import pRetry, { AbortError } from "p-retry";

export type RetryOptions = {
  retries?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
  factor?: number;
};

export function abortRetry(message: string): AbortError {
  return new AbortError(message);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions & { operation: string },
): Promise<T> {
  return pRetry(fn, {
    retries: opts.retries ?? 4,
    factor: opts.factor ?? 2,
    minTimeout: opts.minTimeoutMs ?? 250,
    maxTimeout: opts.maxTimeoutMs ?? 5_000,
    onFailedAttempt: (err) => {
      // Give downstream logs a stable, actionable string without stack traces.
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          msg: "retrying external call",
          operation: opts.operation,
          attempt: err.attemptNumber,
          retriesLeft: err.retriesLeft,
          error: msg,
        }),
      );
    },
  });
}

