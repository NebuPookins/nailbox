import type { Result } from './api.js';

/**
 * Whether a failed request is worth repeating: network failures (no HTTP status on the
 * error) and server-side 5xx responses. Any other HTTP status (e.g. 4xx) is final.
 */
export function isRetryableError(error: Error): boolean {
	const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
	return status === null || status >= 500;
}

/** Delay before retry number `retryNumber` (1 = first retry): base, 2*base, 4*base, ... */
export function backoffDelayMs(retryNumber: number, baseDelayMs: number): number {
	return baseDelayMs * 2 ** (retryNumber - 1);
}

export interface RetryPolicy {
	maxAttempts: number;
	baseDelayMs: number;
	sleep(ms: number): Promise<void>;
	/** Called before sleeping, with the number of the attempt that just failed. */
	onRetry(info: { failedAttempt: number; maxAttempts: number; error: Error; delayMs: number }): void;
}

/**
 * Runs `attempt` until it succeeds, fails with a non-retryable error, or `maxAttempts`
 * have been made, sleeping with exponential backoff between attempts. Returns the last result.
 */
export async function retryWithBackoff<T>(
	attempt: () => Promise<Result<T>>,
	policy: RetryPolicy
): Promise<Result<T>> {
	for (let attemptNumber = 1; ; attemptNumber++) {
		const result = await attempt();
		if (result.ok || attemptNumber >= policy.maxAttempts || !isRetryableError(result.error)) {
			return result;
		}
		const delayMs = backoffDelayMs(attemptNumber, policy.baseDelayMs);
		console.warn('Retrying failed request', { failedAttempt: attemptNumber, maxAttempts: policy.maxAttempts, delayMs }, result.error);
		policy.onRetry({ failedAttempt: attemptNumber, maxAttempts: policy.maxAttempts, error: result.error, delayMs });
		await policy.sleep(delayMs);
	}
}
