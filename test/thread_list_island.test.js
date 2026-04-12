import test from 'node:test';
import assert from 'node:assert/strict';

import { removeThreadFromItems } from '../src/frontend/thread_list_island.tsx';

function makeThread(threadId, lastUpdated = 1) {
	return {
		type: 'thread',
		threadId,
		senders: [{ name: `Sender ${threadId}`, email: `${threadId}@example.com` }],
		receivers: [],
		lastUpdated,
		subject: `Subject ${threadId}`,
		snippet: `Snippet ${threadId}`,
		messageIds: [`m-${threadId}`],
		labelIds: ['INBOX'],
		visibility: 'updated',
		totalTimeToReadSeconds: 30,
		recentMessageReadTimeSeconds: 30,
	};
}

test('removeThreadFromItems updates a bundle when deleting one of several bundled threads', () => {
	const threadA = makeThread('a', 10);
	const threadB = makeThread('b', 20);
	const threadC = makeThread('c', 30);
	const items = [{
		type: 'bundle',
		bundleId: 'bundle-1',
		threadIds: ['a', 'b', 'c'],
		senders: [],
		lastUpdated: 30,
		subject: 'Bundle subject',
		snippet: 'Bundle snippet',
		visibility: 'updated',
		threadCount: 3,
		memberThreads: [threadA, threadB, threadC],
	}];

	const result = removeThreadFromItems(items, 'b');

	assert.equal(result.length, 1);
	assert.equal(result[0].type, 'bundle');
	assert.deepEqual(result[0].threadIds, ['a', 'c']);
	assert.equal(result[0].threadCount, 2);
	assert.deepEqual(result[0].memberThreads.map((thread) => thread.threadId), ['a', 'c']);
});

test('removeThreadFromItems dissolves a bundle when deleting down to one remaining thread', () => {
	const threadA = makeThread('a', 10);
	const threadB = makeThread('b', 20);
	const items = [{
		type: 'bundle',
		bundleId: 'bundle-1',
		threadIds: ['a', 'b'],
		senders: [],
		lastUpdated: 20,
		subject: 'Bundle subject',
		snippet: 'Bundle snippet',
		visibility: 'updated',
		threadCount: 2,
		memberThreads: [threadA, threadB],
	}];

	const result = removeThreadFromItems(items, 'b');

	assert.equal(result.length, 1);
	assert.equal(result[0].type, 'thread');
	assert.equal(result[0].threadId, 'a');
});
