import test from 'node:test';
import assert from 'node:assert/strict';

import gmailSyncService from '../src/server/services/gmail_sync_service.js';
import threadService from '../src/server/services/thread_service.js';

test('syncRecentThreadsFromGmail continues when one thread refresh fails', async () => {
	const originalSaveThreadPayload = threadService.saveThreadPayload;

	try {
		threadService.saveThreadPayload = async ({ threadPayload }) => {
			if (threadPayload.id === 'bad-thread') {
				throw new Error('bad thread payload');
			}
			return { status: 200 };
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

		const result = await gmailSyncService.syncRecentThreadsFromGmail({
			gmailRequest,
			lastRefresheds: {
				markRefreshed() {
					return Promise.resolve();
				},
			},
		});

		assert.deepEqual(seenThreadIds.sort(), ['bad-thread', 'good-thread']);
		assert.equal(result.threadIds.length, 2);
		assert.deepEqual(result.results, [
			{ threadId: 'good-thread', status: 200 },
			{ threadId: 'bad-thread', status: 500, error: 'bad thread payload' },
		]);
	} finally {
		threadService.saveThreadPayload = originalSaveThreadPayload;
	}
});
