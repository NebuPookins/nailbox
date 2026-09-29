import test from 'node:test';
import assert from 'node:assert/strict';

import { refreshSingleThreadFromGmail, syncRecentThreadsFromGmail } from '../src/server/services/gmail_sync_service.js';

test('syncRecentThreadsFromGmail continues when one thread refresh fails', async () => {
	const fakeThreadService = {
		saveThreadPayload: async ({ threadPayload }) => {
			if (threadPayload.id === 'bad-thread') {
				throw new Error('bad thread payload');
			}
			return { status: 200, changed: threadPayload.id === 'good-thread' };
		},
	};
	const fakeThreadRepository = {
		deleteThread: async () => true,
		listThreadIds: async () => [],
		readThreadJson: async () => ({}),
	};

	const seenThreadIds = [];
	const gmailRequest = async ({ path, query }) => {
		if (path === '/threads' && query.labelIds[0] === 'INBOX') {
			return { threads: [{ id: 'good-thread' }] };
		}
		if (path === '/threads' && query.labelIds[0] === 'TRASH') {
			return { threads: [{ id: 'bad-thread' }] };
		}
		if (path === '/threads/good-thread' || path === '/threads/bad-thread') {
			const threadId = path.split('/').at(-1);
			seenThreadIds.push(threadId);
			return {
				id: threadId,
				messages: [{
					id: `${threadId}-m1`,
					labelIds: ['INBOX'],
					internalDate: 1,
					payload: {
						headers: [],
					},
				}],
			};
		}
		throw new Error(`Unexpected path: ${path}`);
	};

	const result = await syncRecentThreadsFromGmail({
		gmailRequest,
		lastRefresheds: {
			markRefreshed() {
				return Promise.resolve();
			},
		},
		threadRepository: fakeThreadRepository,
		threadService: fakeThreadService,
	});

	assert.deepEqual(seenThreadIds.sort(), ['bad-thread', 'good-thread']);
	assert.equal(result.threadIds.length, 2);
	assert.deepEqual(result.changedThreadIds, ['good-thread']);
	assert.deepEqual(result.results, [
		{ threadId: 'good-thread', status: 200, changed: true },
		{ threadId: 'bad-thread', status: 500, error: 'bad thread payload' },
	]);
});

test('syncRecentThreadsFromGmail re-fetches cached threads that are no longer listed under INBOX or TRASH', async () => {
	// The thread was archived from Gmail's own UI, so neither label listing
	// returns it, but it is still sitting in the local cache.
	const savedThreadIds = [];
	const fakeThreadRepository = {
		deleteThread: async () => true,
		listThreadIds: async () => ['18c2f0a1b2c3d4e5'],
		readThreadJson: async () => ({}),
	};
	const fakeThreadService = {
		saveThreadPayload: async ({ threadPayload }) => {
			savedThreadIds.push(threadPayload.id);
			return { status: 200, changed: true };
		},
	};
	const gmailRequest = async ({ path }) => {
		if (path === '/threads') {
			return { threads: [] };
		}
		if (path === '/threads/18c2f0a1b2c3d4e5') {
			return {
				id: '18c2f0a1b2c3d4e5',
				messages: [{ id: 'm1', labelIds: ['Label_1'], internalDate: 1, payload: { headers: [] } }],
			};
		}
		throw new Error(`Unexpected path: ${path}`);
	};

	const result = await syncRecentThreadsFromGmail({
		gmailRequest,
		lastRefresheds: { markRefreshed: () => Promise.resolve() },
		threadRepository: fakeThreadRepository,
		threadService: fakeThreadService,
	});

	assert.deepEqual(savedThreadIds, ['18c2f0a1b2c3d4e5']);
	assert.deepEqual(result.threadIds, ['18c2f0a1b2c3d4e5']);
	assert.deepEqual(result.changedThreadIds, ['18c2f0a1b2c3d4e5']);
});

test('refreshSingleThreadFromGmail removes a 404ed thread from its bundle', async () => {
	const fakeThreadRepository = {
		deleteThread: async () => true,
		readThreadJson: async () => ({id: 'gone-thread', messages: [{id: 'm1'}]}),
	};
	const gmailRequest = async () => {
		throw Object.assign(new Error('Not Found'), {status: 404});
	};

	let saved = false;
	const bundle = {bundleId: 'bnd_1', threadIds: ['gone-thread', 'other-thread', 'third-thread']};
	const fakeBundles = {
		getBundleForThread: (threadId) => (threadId === 'gone-thread' ? bundle : null),
		updateBundle(bundleId, threadIds) {
			assert.equal(bundleId, 'bnd_1');
			bundle.threadIds = threadIds;
		},
		deleteBundle() {
			throw new Error('should not delete the bundle when 2+ threads remain');
		},
		save: async () => {
			saved = true;
		},
	};

	const result = await refreshSingleThreadFromGmail({
		gmailRequest,
		threadId: 'gone-thread',
		lastRefresheds: {markRefreshed: () => Promise.resolve()},
		threadRepository: fakeThreadRepository,
		threadService: {saveThreadPayload: async () => { throw new Error('should not be called'); }},
		bundles: fakeBundles,
	});

	assert.deepEqual(result, {status: 200, changed: true});
	assert.deepEqual(bundle.threadIds, ['other-thread', 'third-thread']);
	assert.ok(saved, 'expected bundles.save() to be called');
});
