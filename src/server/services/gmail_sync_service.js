import _ from 'lodash';

/**
 * @param {any} gmailRequest
 * @param {string} labelId
 */
export async function listThreadIdsByLabel(gmailRequest, labelId) {
	const response = await gmailRequest({
		path: '/threads',
		query: {
			labelIds: [labelId],
			maxResults: '100',
		},
	});
	return Array.isArray(response.threads) ? response.threads.map((/** @type {any} */ thread) => thread.id) : [];
}

/**
 * @param {{ gmailRequest: any, threadId: string, lastRefresheds: any, threadRepository: any, threadService: any }} params
 */
export async function refreshSingleThreadFromGmail({
	gmailRequest,
	threadId,
	lastRefresheds,
	threadRepository,
	threadService,
}) {
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
		const err = /** @type {any} */ (error);
		if (err.status === 404) {
			return {
				status: await threadRepository.deleteThread(threadId) ? 200 : 500,
			};
		}
		throw error;
	}
}

/**
 * @param {{ gmailRequest: any, lastRefresheds: any, threadRepository: any, threadService: any }} params
 */
export async function syncRecentThreadsFromGmail({
	gmailRequest,
	lastRefresheds,
	threadRepository,
	threadService,
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
			};
		} catch (error) {
			const err = /** @type {Error} */ (error);
			return {
				threadId,
				status: 500,
				error: err.message,
			};
		}
	}));
	return {
		threadIds: uniqueThreadIds,
		results: threadSaveResults,
	};
}

export default {
	listThreadIdsByLabel,
	refreshSingleThreadFromGmail,
	syncRecentThreadsFromGmail,
};
