import test from 'node:test';
import assert from 'node:assert/strict';

import { createThreadRepository } from '../src/server/repositories/thread_repository.js';
import { createThreadService } from '../src/server/services/thread_service.js';

test('deleteThread is idempotent for missing files', async () => {
	const repository = createThreadRepository();
	const deleted = await repository.deleteThread('missing-thread-for-test');
	assert.equal(deleted, true);
});

test('saveThreadPayload rejects invalid thread ids', async () => {
	const threadService = createThreadService({
		threadRepository: {
			deleteThread() {
				throw new Error('should not be called');
			},
			readThreadJson() {
				throw new Error('should not be called');
			},
			saveThreadJson() {
				throw new Error('should not be called');
			},
		},
	});
	const result = await threadService.saveThreadPayload({
		threadPayload: {
			id: '../bad',
			messages: [],
		},
		lastRefresheds: {
			markRefreshed() {
				throw new Error('should not be called');
			},
		},
	});
	assert.deepEqual(result, {
		status: 400,
		body: {humanErrorMessage: 'invalid threadId'},
	});
});

test('getMostRelevantThreads tolerates repository threads and returns formatted summaries', async () => {
	const threadService = createThreadService({
		threadRepository: {
			listThreadIds: async () => ['thread-1'],
			readThread: async () => ({
			id: () => 'thread-1',
			snippet: () => 'Hello',
			messages: () => [{
				getBestReadTimeSeconds: () => 30,
				getInternalDate: () => '10',
			}],
			senders: () => [{name: 'Alice', email: 'alice@example.com'}],
			recipients: () => [{name: 'Bob', email: 'bob@example.com'}],
			lastUpdated: () => 10,
			subject: () => 'Subject',
			messageIds: () => ['m1'],
			labelIds: () => ['INBOX'],
			}),
		},
	});

	const results = await threadService.getMostRelevantThreads({
		hideUntils: {
			get: () => ({
				getVisibility: () => 'updated',
				isWhenIHaveTime: () => false,
			}),
			comparator: () => () => 0,
		},
		limit: 100,
	});

	assert.equal(results.length, 1);
	assert.equal(results[0].threadId, 'thread-1');
	assert.equal(results[0].recentMessageReadTimeSeconds, 30);
});

test('saveThreadPayload evicts a cached thread once no message has the INBOX label, even if only some messages are trashed', async () => {
	// Regression test: a thread can have one message trashed (e.g. the user deleted a
	// single message from within Gmail) while its other messages simply carry a
	// non-INBOX label (e.g. after being filed into a category). Previously this only
	// purged the local cache when *every* message was in TRASH, so the periodic Gmail
	// sync kept re-fetching and re-saving such threads, making them reappear in the
	// inbox even though Gmail no longer considered them inbox threads.
	let deleteThreadCalled = false;
	const threadService = createThreadService({
		threadRepository: {
			deleteThread: async (threadId) => {
				deleteThreadCalled = true;
				assert.equal(threadId, 'thread1');
				return true;
			},
			readThreadJson: async () => ({id: 'thread1', messages: [{id: 'm1'}]}),
			saveThreadJson: () => {
				throw new Error('saveThreadJson should not be called for a thread with no INBOX message');
			},
		},
	});

	const result = await threadService.saveThreadPayload({
		threadPayload: {
			id: 'thread1',
			messages: [
				{id: 'm1', labelIds: ['TRASH', 'Label_30'], internalDate: '1', payload: {headers: []}},
				{id: 'm2', labelIds: ['Label_30'], internalDate: '2', payload: {headers: []}},
			],
		},
		lastRefresheds: {
			markRefreshed() {
				throw new Error('should not be called once the thread is deleted');
			},
		},
	});

	assert.equal(deleteThreadCalled, true);
	assert.deepEqual(result, {status: 200, changed: true});
});

test('saveThreadPayload keeps a cached thread when at least one message still has the INBOX label', async () => {
	let saveThreadJsonCalled = false;
	class FakeMessage {
		constructor(data) {
			this._data = data;
		}
		bestBody() {
			return 'body';
		}
	}
	const threadService = createThreadService({
		threadRepository: {
			deleteThread: () => {
				throw new Error('deleteThread should not be called while a message is still in the inbox');
			},
			readThreadJson: async () => ({}),
			saveThreadJson: async () => {
				saveThreadJsonCalled = true;
			},
		},
		MessageClass: FakeMessage,
	});

	const result = await threadService.saveThreadPayload({
		threadPayload: {
			id: 'thread1',
			messages: [
				{id: 'm1', labelIds: ['TRASH', 'Label_30'], internalDate: '1', payload: {headers: []}},
				{id: 'm2', labelIds: ['INBOX'], internalDate: '2', payload: {headers: []}},
			],
		},
		lastRefresheds: {
			markRefreshed: () => Promise.resolve(),
		},
	});

	assert.equal(saveThreadJsonCalled, true);
	assert.equal(result.status, 200);
});
