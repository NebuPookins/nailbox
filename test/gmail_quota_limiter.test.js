import test from 'node:test';
import assert from 'node:assert/strict';

import { createGmailQuotaLimiter, gmailRequestCost } from '../src/server/services/gmail_quota_limiter.js';

test('gmailRequestCost charges each Gmail call its quota cost', () => {
	assert.equal(gmailRequestCost({ path: '/profile' }), 1);
	assert.equal(gmailRequestCost({ path: '/history' }), 2);
	assert.equal(gmailRequestCost({ path: '/threads' }), 10);
	assert.equal(gmailRequestCost({ path: '/threads/18c2f0a1b2c3d4e5' }), 10);
	assert.equal(gmailRequestCost({ method: 'POST', path: '/threads/18c2f0a1b2c3d4e5/modify' }), 10);
	assert.equal(gmailRequestCost({ path: '/messages/m1/attachments/a1' }), 5);
	assert.equal(gmailRequestCost({ method: 'POST', path: '/messages/send' }), 100);
});

test('createGmailQuotaLimiter spends the burst immediately, then waits for the bucket to refill', async () => {
	let clock = 0;
	const sleeps = [];
	const limiter = createGmailQuotaLimiter({
		unitsPerSecond: 100,
		burstUnits: 50,
		now: () => clock,
		sleep: async (ms) => {
			sleeps.push(ms);
			clock += ms;
		},
	});

	for (let i = 0; i < 5; i++) {
		await limiter.acquire(10);
	}
	assert.deepEqual(sleeps, []);

	await limiter.acquire(10);
	assert.deepEqual(sleeps, [100]);
});

test('createGmailQuotaLimiter serves callers in arrival order', async () => {
	let clock = 0;
	const limiter = createGmailQuotaLimiter({
		unitsPerSecond: 10,
		burstUnits: 10,
		now: () => clock,
		sleep: async (ms) => {
			clock += ms;
		},
	});
	const order = [];

	await Promise.all([
		limiter.acquire(10).then(() => order.push('first')),
		limiter.acquire(10).then(() => order.push('second')),
		limiter.acquire(1).then(() => order.push('third')),
	]);

	assert.deepEqual(order, ['first', 'second', 'third']);
});
