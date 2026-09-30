import test from 'node:test';
import assert from 'node:assert/strict';

import { createGmailSyncState, createGmailSyncer, refreshSingleThreadFromGmail, syncRecentThreadsFromGmail } from '../src/server/services/gmail_sync_service.js';

const threadPayload = (threadId, labelIds = ['INBOX']) => ({
	id: threadId,
	messages: [{ id: `${threadId}-m1`, labelIds, internalDate: 1, payload: { headers: [] } }],
});

// Runs one sync against fakes; each test supplies only what it cares about.
function runSync({
	gmailRequest,
	cachedThreadIds = [],
	readHistoryId = async () => undefined,
	saveThreadPayload = async () => ({ status: 200, changed: true }),
	syncState = createGmailSyncState(),
	now = () => 0,
}) {
	return syncRecentThreadsFromGmail({
		gmailRequest,
		lastRefresheds: { markRefreshed: () => Promise.resolve() },
		threadRepository: {
			deleteThread: async () => true,
			listThreadIds: async () => cachedThreadIds,
			readHistoryId,
			readThreadJson: async () => ({}),
		},
		threadService: { saveThreadPayload },
		syncState,
		now,
	});
}

test('syncRecentThreadsFromGmail continues when one thread refresh fails', async () => {
	const seenThreadIds = [];
	const gmailRequest = async ({ path }) => {
		if (path === '/profile') {
			return { historyId: '1' };
		}
		if (path === '/threads') {
			return { threads: [{ id: 'good-thread' }, { id: 'bad-thread' }] };
		}
		const threadId = path.split('/').at(-1);
		seenThreadIds.push(threadId);
		return threadPayload(threadId);
	};

	const result = await runSync({
		gmailRequest,
		saveThreadPayload: async ({ threadPayload }) => {
			if (threadPayload.id === 'bad-thread') {
				throw new Error('bad thread payload');
			}
			return { status: 200, changed: threadPayload.id === 'good-thread' };
		},
	});

	assert.deepEqual(seenThreadIds.sort(), ['bad-thread', 'good-thread']);
	assert.equal(result.threadIds.length, 2);
	assert.deepEqual(result.changedThreadIds, ['good-thread']);
	assert.deepEqual(result.results, [
		{ threadId: 'good-thread', status: 200, changed: true },
		{ threadId: 'bad-thread', status: 500, error: 'bad thread payload' },
	]);
});

test('syncRecentThreadsFromGmail re-fetches cached threads that are no longer listed under INBOX', async () => {
	// The thread was archived from Gmail's own UI, so the INBOX listing no
	// longer returns it, but it is still sitting in the local cache.
	const savedThreadIds = [];
	const gmailRequest = async ({ path }) => {
		if (path === '/profile') {
			return { historyId: '1' };
		}
		if (path === '/threads') {
			return { threads: [] };
		}
		if (path === '/threads/18c2f0a1b2c3d4e5') {
			return threadPayload('18c2f0a1b2c3d4e5', ['Label_1']);
		}
		throw new Error(`Unexpected path: ${path}`);
	};

	const result = await runSync({
		gmailRequest,
		cachedThreadIds: ['18c2f0a1b2c3d4e5'],
		saveThreadPayload: async ({ threadPayload }) => {
			savedThreadIds.push(threadPayload.id);
			return { status: 200, changed: true };
		},
	});

	assert.deepEqual(savedThreadIds, ['18c2f0a1b2c3d4e5']);
	assert.deepEqual(result.threadIds, ['18c2f0a1b2c3d4e5']);
	assert.deepEqual(result.changedThreadIds, ['18c2f0a1b2c3d4e5']);
});

test('syncRecentThreadsFromGmail re-fetches only inbox threads whose historyId changed or that are not cached', async () => {
	// Regression: re-fetching every cached thread each poll exhausted the
	// per-user Gmail quota for mailboxes with thousands of inbox threads.
	const inboxThreadIds = Array.from({length: 700}, (_, i) => `a${String(i).padStart(15, '0')}`);
	// Far below the 100 most recent, so only a historyId check would catch it
	// (e.g. marked read from another Gmail client).
	const changedThreadId = inboxThreadIds[650];
	const newThreadId = inboxThreadIds[699];
	const fetchedThreadIds = [];
	const listQueries = [];
	const toListing = (id) => ({ id, historyId: id === changedThreadId ? 'h2' : 'h1' });
	const gmailRequest = async ({ path, query }) => {
		if (path === '/profile') {
			return { historyId: '1' };
		}
		if (path === '/threads') {
			listQueries.push(query);
			if (query.pageToken === 'page-2') {
				return { threads: inboxThreadIds.slice(500).map(toListing) };
			}
			return { threads: inboxThreadIds.slice(0, 500).map(toListing), nextPageToken: 'page-2' };
		}
		const threadId = path.split('/').at(-1);
		fetchedThreadIds.push(threadId);
		return threadPayload(threadId);
	};

	const result = await runSync({
		gmailRequest,
		cachedThreadIds: inboxThreadIds.filter((id) => id !== newThreadId),
		readHistoryId: async () => 'h1',
	});

	assert.deepEqual(listQueries.map((query) => query.pageToken), [undefined, 'page-2']);
	assert.deepEqual(fetchedThreadIds, [changedThreadId, newThreadId]);
	assert.deepEqual(result.changedThreadIds, [changedThreadId, newThreadId]);
});

test('syncRecentThreadsFromGmail caps re-fetches per sync and backs off threads that keep failing', async () => {
	// Without backoff, 200 threads that never refresh (e.g. persistent errors)
	// would take every slot and block the other stale threads forever.
	const staleThreadIds = Array.from({length: 450}, (_, i) => `b${String(i).padStart(15, '0')}`);
	const gmailRequest = async ({ path }) => {
		if (path === '/profile') {
			return { historyId: '1' };
		}
		if (path === '/threads') {
			return { threads: [] };
		}
		throw new Error('Gmail keeps failing for this thread');
	};
	const syncState = createGmailSyncState();

	const first = await runSync({ gmailRequest, cachedThreadIds: staleThreadIds, syncState, now: () => 0 });
	// The full reconciliation only runs once; later syncs resume from history.
	const historyOnly = async ({ path }) => (path === '/history' ? { historyId: '1' } : gmailRequest({ path }));
	const second = await runSync({ gmailRequest: historyOnly, cachedThreadIds: staleThreadIds, syncState, now: () => 0 });
	const third = await runSync({ gmailRequest: historyOnly, cachedThreadIds: staleThreadIds, syncState, now: () => 0 });
	const afterBackoff = await runSync({ gmailRequest: historyOnly, cachedThreadIds: staleThreadIds, syncState, now: () => 5 * 60 * 1000 });

	assert.deepEqual(first.threadIds, staleThreadIds.slice(0, 200));
	assert.deepEqual(second.threadIds, staleThreadIds.slice(200, 400));
	assert.deepEqual(third.threadIds, staleThreadIds.slice(400));
	assert.deepEqual(afterBackoff.threadIds, staleThreadIds.slice(0, 200));
	assert.deepEqual(syncState.pendingRefreshes.get(staleThreadIds[0]), { failures: 2, retryAt: 5 * 60 * 1000 + 10 * 60 * 1000 });
});

test('syncRecentThreadsFromGmail fetches fresh changes before leftovers from earlier syncs', async () => {
	const syncState = createGmailSyncState();
	syncState.historyId = '10';
	syncState.pendingRefreshes.set('f000000000000001', { failures: 1, retryAt: 0 });
	const fetchedThreadIds = [];
	const gmailRequest = async ({ path }) => {
		if (path === '/history') {
			return { historyId: '11', history: [{ messagesAdded: [{ message: { id: 'm1', threadId: 'f000000000000002', labelIds: ['INBOX'] } }] }] };
		}
		const threadId = path.split('/').at(-1);
		fetchedThreadIds.push(threadId);
		return threadPayload(threadId);
	};

	await runSync({ gmailRequest, syncState });

	assert.deepEqual(fetchedThreadIds, ['f000000000000002', 'f000000000000001']);
	assert.equal(syncState.pendingRefreshes.size, 0);
});

test('syncRecentThreadsFromGmail fetches only threads changed since the history checkpoint', async () => {
	const cachedThreadId = 'c000000000000001';
	const newInboxThreadId = 'c000000000000002';
	const sentOnlyThreadId = 'c000000000000003';
	const historyQueries = [];
	const fetchedThreadIds = [];
	const gmailRequest = async ({ path, query }) => {
		if (path === '/history') {
			historyQueries.push(query);
			return {
				historyId: '20',
				history: [
					// Archived from another client.
					{ labelsRemoved: [{ message: { id: 'm1', threadId: cachedThreadId, labelIds: ['Label_1'] }, labelIds: ['INBOX'] }] },
					// New mail.
					{ messagesAdded: [{ message: { id: 'm2', threadId: newInboxThreadId, labelIds: ['INBOX', 'UNREAD'] } }] },
					// Mail the user sent, which never touches the inbox cache.
					{ messagesAdded: [{ message: { id: 'm3', threadId: sentOnlyThreadId, labelIds: ['SENT'] } }] },
				],
			};
		}
		if (path.startsWith('/threads/')) {
			const threadId = path.split('/').at(-1);
			fetchedThreadIds.push(threadId);
			return threadPayload(threadId);
		}
		throw new Error(`Unexpected path: ${path}`);
	};
	const syncState = createGmailSyncState();
	syncState.historyId = '10';

	const result = await runSync({
		gmailRequest,
		cachedThreadIds: [cachedThreadId],
		readHistoryId: async () => { throw new Error('should not be called'); },
		syncState,
	});

	assert.deepEqual(historyQueries.map((query) => query.startHistoryId), ['10']);
	assert.deepEqual(fetchedThreadIds.sort(), [cachedThreadId, newInboxThreadId]);
	assert.deepEqual(result.changedThreadIds.sort(), [cachedThreadId, newInboxThreadId]);
	assert.equal(syncState.historyId, '20');
	assert.equal(syncState.pendingRefreshes.size, 0);
});

test('syncRecentThreadsFromGmail falls back to a full inbox reconciliation when the history checkpoint expired', async () => {
	const paths = [];
	const gmailRequest = async ({ path }) => {
		paths.push(path);
		if (path === '/history') {
			throw Object.assign(new Error('Not Found'), { status: 404 });
		}
		if (path === '/profile') {
			return { historyId: '30' };
		}
		if (path === '/threads') {
			return { threads: [{ id: 'd000000000000001', historyId: '5' }] };
		}
		return threadPayload(path.split('/').at(-1));
	};
	const syncState = createGmailSyncState();
	syncState.historyId = '1';

	const result = await runSync({ gmailRequest, syncState });

	assert.deepEqual(paths, ['/history', '/profile', '/threads', '/threads/d000000000000001']);
	assert.deepEqual(result.changedThreadIds, ['d000000000000001']);
	assert.equal(syncState.historyId, '30');
});

test('syncRecentThreadsFromGmail keeps failed refreshes pending and retries them after a backoff', async () => {
	// Otherwise advancing the history checkpoint would drop the change for good.
	const flakyThreadId = 'e000000000000001';
	let failNextFetch = true;
	const fetchedThreadIds = [];
	const gmailRequest = async ({ path }) => {
		if (path === '/history') {
			return fetchedThreadIds.length === 0
				? { historyId: '11', history: [{ messagesAdded: [{ message: { id: 'm1', threadId: flakyThreadId, labelIds: ['INBOX'] } }] }] }
				: { historyId: '11' };
		}
		fetchedThreadIds.push(path.split('/').at(-1));
		if (failNextFetch) {
			failNextFetch = false;
			throw Object.assign(new Error('Quota exceeded'), { status: 403 });
		}
		return threadPayload(flakyThreadId);
	};
	const syncState = createGmailSyncState();
	syncState.historyId = '10';

	await runSync({ gmailRequest, syncState, now: () => 0 });
	assert.deepEqual(syncState.pendingRefreshes.get(flakyThreadId), { failures: 1, retryAt: 5 * 60 * 1000 });

	const tooSoon = await runSync({ gmailRequest, syncState, now: () => 60 * 1000 });
	assert.deepEqual(tooSoon.threadIds, []);

	const retry = await runSync({ gmailRequest, syncState, now: () => 5 * 60 * 1000 });
	assert.deepEqual(fetchedThreadIds, [flakyThreadId, flakyThreadId]);
	assert.deepEqual(retry.changedThreadIds, [flakyThreadId]);
	assert.equal(syncState.pendingRefreshes.size, 0);
});

function makeGatedSyncer() {
	const gates = [];
	let historyCalls = 0;
	const gmailRequest = async ({ path }) => {
		if (path === '/history') {
			historyCalls += 1;
			await new Promise((resolve) => gates.push(resolve));
			return { historyId: String(7 + historyCalls) };
		}
		throw new Error(`Unexpected path: ${path}`);
	};
	const savedHistoryIds = [];
	const loadedState = createGmailSyncState();
	loadedState.historyId = '7';
	const syncer = createGmailSyncer({
		lastRefresheds: { markRefreshed: () => Promise.resolve() },
		stateRepository: {
			load: async () => loadedState,
			save: async (state) => { savedHistoryIds.push(state.historyId); },
		},
		threadRepository: {
			deleteThread: async () => true,
			listThreadIds: async () => [],
			readHistoryId: async () => undefined,
			readThreadJson: async () => ({}),
		},
		threadService: { saveThreadPayload: async () => ({ status: 200, changed: true }) },
	});
	// Lets the next pending /history call return once it has been made, and
	// fails (rather than hangs) if no such call is ever made.
	const releaseNextHistoryCall = async () => {
		for (let tries = 0; gates.length === 0; tries++) {
			if (tries > 100) {
				throw new Error('expected another /history call');
			}
			await new Promise((resolve) => setImmediate(resolve));
		}
		gates.shift()();
	};
	return { syncer, gmailRequest, savedHistoryIds, releaseNextHistoryCall, historyCalls: () => historyCalls };
}

test('createGmailSyncer runs one follow-up sync for callers that arrive while a sync is in flight', async () => {
	// A manual sync clicked mid-poll may be about a change that poll already
	// missed, so it must not just reuse the poll's result.
	const { syncer, gmailRequest, savedHistoryIds, releaseNextHistoryCall, historyCalls } = makeGatedSyncer();

	const backgroundPoll = syncer.sync(gmailRequest);
	const manualSync = syncer.sync(gmailRequest);
	const secondManualSync = syncer.sync(gmailRequest);
	await releaseNextHistoryCall();
	await backgroundPoll;
	await releaseNextHistoryCall();

	assert.equal(await manualSync, await secondManualSync);
	assert.notEqual(await backgroundPoll, await manualSync);
	assert.equal(historyCalls(), 2);
	assert.deepEqual(savedHistoryIds, ['8', '9']);
});

test('createGmailSyncer starts a fresh sync when none is in flight', async () => {
	const { syncer, gmailRequest, releaseNextHistoryCall, historyCalls } = makeGatedSyncer();

	const first = syncer.sync(gmailRequest);
	await releaseNextHistoryCall();
	await first;
	const second = syncer.sync(gmailRequest);
	await releaseNextHistoryCall();
	await second;

	assert.equal(historyCalls(), 2);
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
