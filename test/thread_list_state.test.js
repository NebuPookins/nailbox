import test from 'node:test';
import assert from 'node:assert/strict';

import {
	initialThreadListState,
	removalConfirmed,
	removalFailed,
	removalStarted,
	snapshotReceived,
	snapshotRequested,
	visibleGroups,
} from '../src/frontend/thread_list_state.js';

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

function makeBundle(bundleId, threads) {
	return {
		type: 'bundle',
		bundleId,
		threadIds: threads.map((thread) => thread.threadId),
		senders: [],
		lastUpdated: 30,
		subject: 'Bundle subject',
		snippet: 'Bundle snippet',
		visibility: 'updated',
		threadCount: threads.length,
		memberThreads: threads,
		totalTimeToReadSeconds: 30,
		recentMessageReadTimeSeconds: 30,
	};
}

function groupOf(...items) {
	return [{ label: 'Inbox', items }];
}

function visibleRowIds(state) {
	return visibleGroups(state).flatMap((group) => group.items.map((item) => (
		item.type === 'bundle' ? item.bundleId : item.threadId
	)));
}

/** Requests a snapshot and delivers it straight away. */
function receiveSnapshot(state, groups) {
	const [requested, requestedAt] = snapshotRequested(state);
	return snapshotReceived(requested, groups, requestedAt);
}

const thread = { kind: 'thread', threadId: 'a' };

test('a snapshot requested before a removal was confirmed does not resurrect the thread', () => {
	let state = receiveSnapshot(initialThreadListState(), groupOf(makeThread('a'), makeThread('b')));
	state = removalStarted(state, 'r1', thread);
	const [requested, requestedAt] = snapshotRequested(state);
	state = removalConfirmed(requested, 'r1');

	state = snapshotReceived(state, groupOf(makeThread('a'), makeThread('b')), requestedAt);

	assert.deepEqual(visibleRowIds(state), ['b']);
});

test('a snapshot received while a removal is in flight keeps the thread hidden', () => {
	let state = receiveSnapshot(initialThreadListState(), groupOf(makeThread('a'), makeThread('b')));
	state = removalStarted(state, 'r1', thread);

	state = receiveSnapshot(state, groupOf(makeThread('a'), makeThread('b')));

	assert.deepEqual(visibleRowIds(state), ['b']);
});

test('a thread is hidden as soon as its removal starts', () => {
	let state = receiveSnapshot(initialThreadListState(), groupOf(makeThread('a'), makeThread('b')));

	state = removalStarted(state, 'r1', thread);

	assert.deepEqual(visibleRowIds(state), ['b']);
});

test('a failed removal makes the row visible again', () => {
	let state = receiveSnapshot(initialThreadListState(), groupOf(makeThread('a'), makeThread('b')));
	state = removalStarted(state, 'r1', thread);

	state = removalFailed(state, 'r1');

	assert.deepEqual(visibleRowIds(state), ['a', 'b']);
});

test('a confirmed removal stays hidden until a snapshot requested after the confirmation arrives', () => {
	let state = receiveSnapshot(initialThreadListState(), groupOf(makeThread('a'), makeThread('b')));
	state = removalStarted(state, 'r1', thread);
	state = removalConfirmed(state, 'r1');
	assert.deepEqual(visibleRowIds(state), ['b']);

	// The server still lists the thread (e.g. it came back), and this snapshot is authoritative.
	state = receiveSnapshot(state, groupOf(makeThread('a'), makeThread('b')));

	assert.deepEqual(visibleRowIds(state), ['a', 'b']);
});

test('an older snapshot does not replace a newer one', () => {
	const [first, olderRequestedAt] = snapshotRequested(initialThreadListState());
	const [second, newerRequestedAt] = snapshotRequested(first);
	let state = snapshotReceived(second, groupOf(makeThread('new')), newerRequestedAt);

	state = snapshotReceived(state, groupOf(makeThread('old')), olderRequestedAt);

	assert.deepEqual(visibleRowIds(state), ['new']);
});

test('removing one of several bundled threads shrinks the bundle', () => {
	const bundle = makeBundle('bundle-1', [makeThread('a', 10), makeThread('b', 20), makeThread('c', 30)]);
	let state = receiveSnapshot(initialThreadListState(), groupOf(bundle));

	state = removalStarted(state, 'r1', { kind: 'thread', threadId: 'b' });

	const [row] = visibleGroups(state)[0].items;
	assert.equal(row.type, 'bundle');
	assert.deepEqual(row.threadIds, ['a', 'c']);
	assert.equal(row.threadCount, 2);
	assert.deepEqual(row.memberThreads.map((member) => member.threadId), ['a', 'c']);
});

test('removing a bundled thread down to one remaining thread unbundles it', () => {
	const bundle = makeBundle('bundle-1', [makeThread('a', 10), makeThread('b', 20)]);
	let state = receiveSnapshot(initialThreadListState(), groupOf(bundle));

	state = removalStarted(state, 'r1', { kind: 'thread', threadId: 'b' });

	const [row] = visibleGroups(state)[0].items;
	assert.equal(row.type, 'thread');
	assert.equal(row.threadId, 'a');
});

test('removing a bundle hides the bundle row', () => {
	const bundle = makeBundle('bundle-1', [makeThread('a'), makeThread('b')]);
	let state = receiveSnapshot(initialThreadListState(), groupOf(bundle, makeThread('c')));

	state = removalStarted(state, 'r1', { kind: 'bundle', bundleId: 'bundle-1' });

	assert.deepEqual(visibleRowIds(state), ['c']);
});

test('groups left empty by a removal are dropped', () => {
	let state = receiveSnapshot(initialThreadListState(), groupOf(makeThread('a')));

	state = removalStarted(state, 'r1', thread);

	assert.deepEqual(visibleGroups(state), []);
});

test('there is nothing to show before the first snapshot arrives', () => {
	assert.deepEqual(visibleGroups(initialThreadListState()), []);
});
