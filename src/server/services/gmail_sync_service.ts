import _ from 'lodash';

import {removeThreadFromBundle} from '../../../models/bundle.js';
import type {ThreadRepository} from '../types/thread.js';

// Bounds simultaneous Gmail thread fetches so a large cache doesn't trip the
// per-user rate limit.
const MAX_CONCURRENT_THREAD_REFRESHES = 5;

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

export async function listThreadIdsByLabel(gmailRequest: any, labelId: string): Promise<string[]> {
	const response = await gmailRequest({
		path: '/threads',
		query: {
			labelIds: [labelId],
			maxResults: '100',
		},
	});
	return Array.isArray(response.threads) ? response.threads.map((thread: any) => thread.id) : [];
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
	threadRepository: Pick<ThreadRepository, 'deleteThread' | 'readThreadJson'>;
	threadService: any;
	bundles?: any;
}): Promise<{status: number; changed?: boolean}> {
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

export async function syncRecentThreadsFromGmail({
	gmailRequest,
	lastRefresheds,
	threadRepository,
	threadService,
	bundles,
}: {
	gmailRequest: any;
	lastRefresheds: any;
	threadRepository: Pick<ThreadRepository, 'deleteThread' | 'listThreadIds' | 'readThreadJson'>;
	threadService: any;
	bundles?: any;
}) {
	const [inboxThreadIds, trashThreadIds, cachedThreadIds] = await Promise.all([
		listThreadIdsByLabel(gmailRequest, 'INBOX'),
		listThreadIdsByLabel(gmailRequest, 'TRASH'),
		threadRepository.listThreadIds(),
	]);
	// Cached threads are refreshed too: a thread archived or relabeled from
	// another client shows up in neither label listing, so it would otherwise
	// linger in the local cache forever.
	const uniqueThreadIds = _.uniq([...inboxThreadIds, ...trashThreadIds, ...cachedThreadIds]);
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
	const changedThreadIds = threadSaveResults
		.filter((result) => result.status < 400 && result.changed)
		.map((result) => result.threadId);
	return {
		changedThreadIds,
		threadIds: uniqueThreadIds,
		results: threadSaveResults,
	};
}

export default {
	listThreadIdsByLabel,
	refreshSingleThreadFromGmail,
	syncRecentThreadsFromGmail,
};
