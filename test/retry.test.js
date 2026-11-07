import test from 'node:test';
import assert from 'node:assert/strict';

import { isRetryableError, backoffDelayMs, retryWithBackoff } from '../src/frontend/retry.js';

function httpError(status) {
	return Object.assign(new Error('HTTP ' + status), { status });
}

test('isRetryableError retries network failures and 5xx but not 4xx', () => {
	assert.equal(isRetryableError(new TypeError('Failed to fetch')), true);
	assert.equal(isRetryableError(httpError(500)), true);
	assert.equal(isRetryableError(httpError(503)), true);
	assert.equal(isRetryableError(httpError(400)), false);
	assert.equal(isRetryableError(httpError(404)), false);
});

test('backoffDelayMs doubles each retry', () => {
	assert.deepEqual([1, 2, 3, 4].map((n) => backoffDelayMs(n, 500)), [500, 1000, 2000, 4000]);
});

function makePolicy(overrides = {}) {
	const sleeps = [];
	const retries = [];
	return {
		sleeps,
		retries,
		policy: {
			maxAttempts: 5,
			baseDelayMs: 500,
			async sleep(ms) { sleeps.push(ms); },
			onRetry(info) { retries.push(info.failedAttempt); },
			...overrides,
		},
	};
}

test('retryWithBackoff returns the first success without sleeping', async () => {
	const { policy, sleeps } = makePolicy();
	const result = await retryWithBackoff(async () => ({ ok: true, value: 7 }), policy);
	assert.deepEqual(result, { ok: true, value: 7 });
	assert.deepEqual(sleeps, []);
});

test('retryWithBackoff retries retryable failures with exponential delays until success', async () => {
	const { policy, sleeps, retries } = makePolicy();
	let calls = 0;
	const result = await retryWithBackoff(async () => {
		calls++;
		return calls < 3 ? { ok: false, error: httpError(502) } : { ok: true, value: 'done' };
	}, policy);
	assert.deepEqual(result, { ok: true, value: 'done' });
	assert.equal(calls, 3);
	assert.deepEqual(sleeps, [500, 1000]);
	assert.deepEqual(retries, [1, 2]);
});

test('retryWithBackoff gives up after maxAttempts and returns the last error', async () => {
	const { policy } = makePolicy();
	let calls = 0;
	const result = await retryWithBackoff(async () => {
		calls++;
		return { ok: false, error: new TypeError('Failed to fetch') };
	}, policy);
	assert.equal(result.ok, false);
	assert.equal(result.error.message, 'Failed to fetch');
	assert.equal(calls, 5);
});

test('retryWithBackoff fails immediately on a 4xx', async () => {
	const { policy, sleeps } = makePolicy();
	let calls = 0;
	const result = await retryWithBackoff(async () => {
		calls++;
		return { ok: false, error: httpError(404) };
	}, policy);
	assert.equal(result.ok, false);
	assert.equal(result.error.message, 'HTTP 404');
	assert.equal(calls, 1);
	assert.deepEqual(sleeps, []);
});
