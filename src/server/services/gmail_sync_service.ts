import _ from 'lodash';

import {removeThreadFromBundle} from '../../../models/bundle.js';
import {isInInbox} from '../validation/contracts.js';
import type {ThreadRepository} from '../types/thread.js';

// Bounds simultaneous Gmail thread fetches so a large cache doesn't trip the
// per-user rate limit.
const MAX_CONCURRENT_THREAD_REFRESHES = 5;
// Keeps any one sync from monopolizing the shared Gmail quota (see
// gmail_quota_limiter) and delaying user actions. Threads beyond this cap stay
// pending and are picked up by later syncs.
const MAX_THREAD_REFRESHES_PER_SYNC = 200;
// A thread whose refresh fails is retried after an exponentially growing
// delay, so threads that always fail stop taking slots from the rest.
const FIRST_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
// Reading cached historyIds is local file I/O; bound it to avoid EMFILE.
const MAX_CONCURRENT_HISTORY_ID_READS = 20;

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]);
		}
	};
	await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
	return results;
}

interface ThreadListing {
	id: string;
	historyId?: string;
}

// Yields each page of a paginated Gmail list endpoint, 500 items per page.
async function* gmailPages(gmailRequest: any, path: string, query: Record<string, unknown>): AsyncGenerator<any> {
	let pageToken: string | undefined;
	do {
		const response = await gmailRequest({
			path,
			query: {...query, maxResults: '500', ...(pageToken ? {pageToken} : {})},
		});
		yield response;
		pageToken = response.nextPageToken;
	} while (pageToken);
}

// Lists every thread under a label. threads.list costs 5 quota units per
// page, far cheaper than fetching each thread.
async function listThreadsByLabel(gmailRequest: any, labelId: string): Promise<ThreadListing[]> {
	const threads: ThreadListing[] = [];
	for await (const page of gmailPages(gmailRequest, '/threads', {labelIds: [labelId]})) {
		for (const thread of page.threads ?? []) {
			threads.push({id: thread.id, historyId: thread.historyId});
		}
	}
	return threads;
}

export async function refreshSingleThreadFromGmail({
	gmailRequest,
	threadId,
	lastRefresheds,
	threadRepository,
	threadService,
	bundles,
}: {
	gmailRequest: any;
	threadId: string;
	lastRefresheds: any;
	threadRepository: Pick<ThreadRepository, 'deleteThread' | 'readDeletionCount' | 'readThreadJson'>;
	threadService: any;
	bundles?: any;
}): Promise<{status: number; changed?: boolean}> {
	const deletionCountAtFetch = threadRepository.readDeletionCount(threadId);
	try {
		const gmailThread = await gmailRequest({
			path: `/threads/${threadId}`,
			query: {
				format: 'full',
			},
		});
		return threadService.saveThreadPayload({
			threadPayload: gmailThread,
			lastRefresheds,
			deletionCountAtFetch,
		});
	} catch (error) {
		const err = error as {status?: number};
		if (err.status === 404) {
			const existingThread = await threadRepository.readThreadJson(threadId);
			const deleted = await threadRepository.deleteThread(threadId);
			if (deleted && bundles) {
				await removeThreadFromBundle(bundles, threadId);
			}
			return {
				status: deleted ? 200 : 500,
				changed: Boolean(existingThread && Object.keys(existingThread).length > 0),
			};
		}
		throw error;
	}
}

export interface GmailSyncState {
	// Mailbox historyId the next sync reads changes from. Unset until a full
	// reconciliation has run, e.g. after a restart.
	historyId?: string;
	// Threads known to need re-fetching that a capped sync hasn't got to, or
	// whose refresh failed and should be retried.
	pendingRefreshes: Map<string, PendingRefresh>;
}

export interface PendingRefresh {
	// Consecutive failed refresh attempts.
	failures: number;
	// Epoch ms before which the thread isn't retried.
	retryAt: number;
}

export function createGmailSyncState(): GmailSyncState {
	return {pendingRefreshes: new Map()};
}

function retryDelayMs(failures: number): number {
	return Math.min(FIRST_RETRY_DELAY_MS * 2 ** (failures - 1), MAX_RETRY_DELAY_MS);
}

const HISTORY_MESSAGE_KEYS = ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved'];

// Returns every thread touched since startHistoryId, with its messages'
// current labels where Gmail reports them, plus the mailbox historyId to
// resume from. users.history.list costs 2 quota units per page. Returns null
// when Gmail no longer has history that far back (HTTP 404).
async function listThreadChangesSince(gmailRequest: any, startHistoryId: string): Promise<{
	historyId: string;
	threads: Map<string, boolean>;
} | null> {
	// threadId -> whether any changed message is labeled INBOX.
	const threads = new Map<string, boolean>();
	let historyId = startHistoryId;
	try {
		for await (const page of gmailPages(gmailRequest, '/history', {startHistoryId})) {
			for (const record of page.history ?? []) {
				for (const key of HISTORY_MESSAGE_KEYS) {
					for (const {message} of record[key] ?? []) {
						threads.set(message.threadId, Boolean(threads.get(message.threadId)) || isInInbox(message));
					}
				}
			}
			historyId = page.historyId ?? historyId;
		}
	} catch (error) {
		if ((error as {status?: number}).status === 404) {
			return null;
		}
		throw error;
	}
	return {historyId, threads};
}

// Compares the full INBOX listing against the cache: returns inbox threads
// that are uncached or whose historyId moved on, plus cached threads no
// longer in the inbox (archived, trashed or relabeled, possibly from another
// client), which a re-fetch evicts.
async function findThreadsOutOfSyncWithInbox(
	gmailRequest: any,
	threadRepository: Pick<ThreadRepository, 'readHistoryId'>,
	cachedThreadIdSet: Set<string>,
): Promise<string[]> {
	const inboxThreads = await listThreadsByLabel(gmailRequest, 'INBOX');
	const inboxThreadNeedsRefresh = await mapWithConcurrency(inboxThreads, MAX_CONCURRENT_HISTORY_ID_READS, async (thread) => {
		if (!cachedThreadIdSet.has(thread.id) || !thread.historyId) {
			return true;
		}
		try {
			return await threadRepository.readHistoryId(thread.id) !== thread.historyId;
		} catch {
			// An unreadable cached copy is replaced by a fresh fetch.
			return true;
		}
	});
	const changedInboxThreadIds = inboxThreads
		.filter((_thread, index) => inboxThreadNeedsRefresh[index])
		.map((thread) => thread.id);
	const inboxThreadIdSet = new Set(inboxThreads.map((thread) => thread.id));
	const staleCachedThreadIds = [...cachedThreadIdSet].filter((threadId) => !inboxThreadIdSet.has(threadId));
	return [...changedInboxThreadIds, ...staleCachedThreadIds];
}

export async function syncRecentThreadsFromGmail({
	gmailRequest,
	lastRefresheds,
	threadRepository,
	threadService,
	bundles,
	syncState,
	now = Date.now,
}: {
	gmailRequest: any;
	lastRefresheds: any;
	threadRepository: Pick<ThreadRepository, 'deleteThread' | 'listThreadIds' | 'readDeletionCount' | 'readHistoryId' | 'readThreadJson'>;
	threadService: any;
	bundles?: any;
	// Shared by every caller, so all syncs resume from one history checkpoint.
	syncState: GmailSyncState;
	now?: () => number;
}) {
	const [cachedThreadIds, changes] = await Promise.all([
		threadRepository.listThreadIds(),
		syncState.historyId ? listThreadChangesSince(gmailRequest, syncState.historyId) : null,
	]);
	const cachedThreadIdSet = new Set(cachedThreadIds);
	let foundThreadIds: string[];
	if (changes) {
		// Only threads the local cache cares about: already cached, or with a
		// message now in the inbox.
		foundThreadIds = [...changes.threads]
			.filter(([threadId, inInbox]) => inInbox || cachedThreadIdSet.has(threadId))
			.map(([threadId]) => threadId);
		syncState.historyId = changes.historyId;
	} else {
		// No usable checkpoint, so reconcile against the full inbox. The
		// checkpoint is taken first so changes made during the listing are
		// still picked up by the next sync.
		const profile = await gmailRequest({path: '/profile'});
		foundThreadIds = await findThreadsOutOfSyncWithInbox(gmailRequest, threadRepository, cachedThreadIdSet);
		syncState.historyId = profile.historyId;
	}
	const startedAt = now();
	const pending = syncState.pendingRefreshes;
	// A fresh change makes a thread due again, even one backing off after
	// failures.
	for (const threadId of foundThreadIds) {
		pending.set(threadId, {failures: pending.get(threadId)?.failures ?? 0, retryAt: startedAt});
	}
	// Fresh changes first, in the order found (newest inbox mail first), then
	// earlier leftovers, least-failed first.
	const foundThreadIdSet = new Set(foundThreadIds);
	const dueLeftoverThreadIds = _.sortBy(
		[...pending].filter(([threadId, refresh]) => !foundThreadIdSet.has(threadId) && refresh.retryAt <= startedAt),
		([, refresh]) => refresh.failures,
	).map(([threadId]) => threadId);
	const uniqueThreadIds = [..._.uniq(foundThreadIds), ...dueLeftoverThreadIds]
		.slice(0, MAX_THREAD_REFRESHES_PER_SYNC);
	const threadSaveResults = await mapWithConcurrency(uniqueThreadIds, MAX_CONCURRENT_THREAD_REFRESHES, async (threadId) => {
		try {
			const saveResult = await refreshSingleThreadFromGmail({
				gmailRequest,
				threadId,
				lastRefresheds,
				threadRepository,
				threadService,
				bundles,
			});
			return {
				threadId,
				status: saveResult.status,
				changed: Boolean(saveResult.changed),
			};
		} catch (error) {
			const err = error as Error;
			return {
				threadId,
				status: 500,
				error: err.message,
			};
		}
	});
	for (const result of threadSaveResults) {
		if (result.status < 400) {
			pending.delete(result.threadId);
		} else {
			const failures = (pending.get(result.threadId)?.failures ?? 0) + 1;
			pending.set(result.threadId, {failures, retryAt: startedAt + retryDelayMs(failures)});
		}
	}
	const changedThreadIds = threadSaveResults
		.filter((result) => result.status < 400 && result.changed)
		.map((result) => result.threadId);
	return {
		changedThreadIds,
		threadIds: uniqueThreadIds,
		results: threadSaveResults,
	};
}

export interface GmailSyncStateRepository {
	load(): Promise<GmailSyncState>;
	save(state: GmailSyncState): Promise<void>;
}

type SyncResult = Awaited<ReturnType<typeof syncRecentThreadsFromGmail>>;

// Owns the sync state shared by every caller (the background poller and the
// manual sync route), persists it between runs, and runs at most one sync at a
// time. A caller arriving while one is in flight may have seen a change that
// sync already missed, so it gets a follow-up sync once the current one ends;
// every caller arriving meanwhile shares that single follow-up.
export function createGmailSyncer({
	bundles,
	lastRefresheds,
	stateRepository,
	threadRepository,
	threadService,
}: {
	bundles?: any;
	lastRefresheds: any;
	stateRepository: GmailSyncStateRepository;
	threadRepository: Pick<ThreadRepository, 'deleteThread' | 'listThreadIds' | 'readDeletionCount' | 'readHistoryId' | 'readThreadJson'>;
	threadService: any;
}) {
	let syncState: GmailSyncState | undefined;
	let inFlight: Promise<SyncResult> | null = null;
	let followUp: Promise<SyncResult> | null = null;

	async function runSync(gmailRequest: any): Promise<SyncResult> {
		syncState ??= await stateRepository.load();
		const result = await syncRecentThreadsFromGmail({
			gmailRequest,
			lastRefresheds,
			threadRepository,
			threadService,
			bundles,
			syncState,
		});
		await stateRepository.save(syncState);
		return result;
	}

	function start(gmailRequest: any): Promise<SyncResult> {
		const run = runSync(gmailRequest).finally(() => {
			inFlight = null;
		});
		inFlight = run;
		return run;
	}

	function sync(gmailRequest: any): Promise<SyncResult> {
		if (!inFlight) {
			return start(gmailRequest);
		}
		followUp ??= inFlight.catch(() => undefined).then(() => {
			followUp = null;
			return start(gmailRequest);
		});
		return followUp;
	}

	return {sync};
}

export default {
	createGmailSyncer,
	refreshSingleThreadFromGmail,
	syncRecentThreadsFromGmail,
};
