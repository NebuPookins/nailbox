import _ from 'lodash';

import threadRepository from '../repositories/thread_repository.js';
import threadService from './thread_service.js';

export async function listThreadIdsByLabel(gmailRequest, labelId) {
	const response = await gmailRequest({
		path: '/threads',
		query: {
			labelIds: [labelId],
			maxResults: '100',
		},
	});
	return Array.isArray(response.threads) ? response.threads.map((thread) => thread.id) : [];
}

export async function refreshSingleThreadFromGmail({
	gmailRequest,
	threadId,
	lastRefresheds,
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
		if (error.status === 404) {
			return {
				status: await threadRepository.deleteThread(threadId) ? 200 : 500,
			};
		}
		throw error;
	}
}

export async function syncRecentThreadsFromGmail({
	gmailRequest,
	lastRefresheds,
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
			});
			return {
				threadId,
				status: saveResult.status,
			};
		} catch (error) {
			return {
				threadId,
				status: 500,
				error: error.message,
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
