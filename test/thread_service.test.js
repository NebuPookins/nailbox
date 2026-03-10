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
		lastRefresheds: {
			needsRefreshing: () => false,
		},
		limit: 100,
	});

	assert.equal(results.length, 1);
	assert.equal(results[0].threadId, 'thread-1');
	assert.equal(results[0].recentMessageReadTimeSeconds, 30);
});
