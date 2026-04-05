import _ from 'lodash';

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
}: {
	gmailRequest: any;
	threadId: string;
	lastRefresheds: any;
	threadRepository: any;
	threadService: any;
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
			return {
				status: await threadRepository.deleteThread(threadId) ? 200 : 500,
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
}: {
	gmailRequest: any;
	lastRefresheds: any;
	threadRepository: any;
	threadService: any;
}) {
	const [inboxThreadIds, trashThreadIds] = await Promise.all([
		listThreadIdsByLabel(gmailRequest, 'INBOX'),
		listThreadIdsByLabel(gmailRequest, 'TRASH'),
	]);
	const uniqueThreadIds = _.uniq(inboxThreadIds.concat(trashThreadIds));
	const threadSaveResults = await Promise.all(uniqueThreadIds.map(async (threadId) => {
		try {
			const saveResult = await refreshSingleThreadFromGmail({
				gmailRequest,
				threadId,
				lastRefresheds,
				threadRepository,
				threadService,
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
	}));
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
