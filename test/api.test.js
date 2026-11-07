import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppApi } from '../src/frontend/api.js';

test('api methods return a failed Result instead of rejecting when the request cannot reach the server', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => {
		throw new TypeError('Failed to fetch');
	});
	t.mock.method(console, 'error', () => {});

	const result = await createAppApi().sendMessage({ threadId: 'thread-1', raw: 'raw-message' });

	assert.equal(result.ok, false);
	assert.equal(result.error.message, 'Failed to fetch');
});
