import util from 'util';

import nebulog from 'nebulog';

import {removeThreadFromBundle} from '../../../models/bundle.js';
import {countWords, htmlToPlainText, readTimeSecondsFor, sanitizeEmailHtml} from './email_html.js';
import {verifySender} from './sender_verification.js';
import {
	isInInbox,
	isThreadId,
	normalizeThreadMessageDto,
	normalizeThreadSummaryDto,
	validateThreadPayload,
} from '../validation/contracts.js';
import type {PersistedMessage, PersistedThread, ThreadSummaryDto, ThreadMessageDto, ThreadSummaryFields} from '../types/thread.js';

const logger = nebulog.make({filename: 'src/server/services/thread_service.js', level: 'info'});

export function createThreadService(dependencies: {
	threadRepository?: any;
	MessageClass?: any;
	bundles?: any;
} = {}) {
	const {threadRepository: repository, MessageClass, bundles} = dependencies;

	function markRefreshed(lastRefresheds: any, threadId: string): void {
		lastRefresheds.markRefreshed(threadId).catch((saveError: any) => {
			logger.error(util.format('Failed to save last refreshed for %s: %s', threadId, util.inspect(saveError)));
		});
	}

	/**
	 * Caches a thread fetched from Gmail, or evicts it if it has left the
	 * inbox. Pass deletionCountAtFetch, read from the repository before the
	 * fetch, so a thread deleted meanwhile isn't brought back.
	 */
	async function saveThreadPayload({
		threadPayload,
		lastRefresheds,
		deletionCountAtFetch,
	}: {
		threadPayload: any;
		lastRefresheds: any;
		deletionCountAtFetch?: number;
	}): Promise<{status: number; changed?: boolean; body?: {humanErrorMessage: string}}> {
		try {
			validateThreadPayload(threadPayload);
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'INVALID_CONTRACT') {
				return {
					status: 400,
					body: {humanErrorMessage: err.message},
				};
			}
			throw error;
		}

		const threadId: string = threadPayload.id;
		if (!isThreadId(threadId)) {
			return {
				status: 400,
				body: {humanErrorMessage: 'invalid threadId'},
			};
		}

		const noMessageInInbox = !threadPayload.messages.some(isInInbox);
		if (noMessageInInbox) {
			logger.info(`Evicting thread ${threadId} because no message in the thread is in the inbox.`);
			const outcome = await repository.evictThread(threadId, threadPayload.historyId);
			if ((outcome === 'deleted' || outcome === 'absent') && bundles) {
				await removeThreadFromBundle(bundles, threadId);
			}
			return {
				status: outcome === 'failed' ? 500 : 200,
				changed: outcome === 'deleted',
			};
		}

		// Gmail bumps a thread's historyId on every change, so a matching one
		// means the cached copy is current and needn't be re-read or rewritten.
		// Just a shortcut: saveThreadJson re-checks under the thread's lock.
		if (threadPayload.historyId && await repository.readHistoryId(threadId) === threadPayload.historyId) {
			markRefreshed(lastRefresheds, threadId);
			return {status: 200, changed: false};
		}

		const newThread: PersistedThread = {
			...threadPayload,
			messages: threadPayload.messages.map((messageData: PersistedMessage) => ({
				...messageData,
				calculatedTimeToReadSeconds: readTimeSecondsFor(countWords(plainTextOf(new MessageClass(messageData)))),
			})),
		};
		const didChange = await repository.saveThreadJson(threadId, newThread, {deletionCountAtFetch});
		markRefreshed(lastRefresheds, threadId);
		return {
			status: 200,
			changed: didChange,
		};
	}

	async function getMostRelevantThreads({
		hideUntils,
		limit = 100,
	}: {
		hideUntils: any;
		limit?: number;
	}): Promise<ThreadSummaryDto[]> {
		const summaries: readonly ThreadSummaryFields[] = await repository.listThreadSummaries();
		const now = Date.now();
		const formattedThreads: ThreadSummaryDto[] = summaries.flatMap((fields) => {
			try {
				const hideUntil = hideUntils.get({threadId: fields.threadId, lastUpdated: fields.lastUpdated});
				return [normalizeThreadSummaryDto({
					...fields,
					visibility: hideUntil.getVisibility(fields.lastUpdated, now),
					isWhenIHaveTime: hideUntil.isWhenIHaveTime(),
				})];
			} catch (error) {
				logger.warn(`Couldn't summarise certain threads in getMostRelevantThreads. Ignoring and continuing. threadId=${fields.threadId} ${util.inspect(error)}`);
				return [];
			}
		}).filter((x) => x.visibility !== 'hidden');
		formattedThreads.sort(hideUntils.comparator());
		formattedThreads.length = Math.min(formattedThreads.length, limit);
		return formattedThreads;
	}

	async function getThreadMessages(threadId: string): Promise<{thread: any; data: {messages: ThreadMessageDto[]}}> {
		const thread = await repository.readThread(threadId);
		return {
			thread,
			data: {
				messages: thread.messages().map(loadRelevantDataFromMessage),
			},
		};
	}

	async function getThreadMessage(threadId: string, messageId: string): Promise<{status: number; data?: ThreadMessageDto}> {
		const thread = await repository.readThread(threadId);
		const matchingMessage = thread.message(messageId);
		if (!matchingMessage) {
			return {status: 404};
		}
		return {
			status: 200,
			data: loadRelevantDataFromMessage(matchingMessage),
		};
	}

	return {
		getMostRelevantThreads,
		getThreadMessage,
		getThreadMessages,
		loadRelevantDataFromMessage,
		saveThreadPayload,
	};
}

/** `htmlBody` saves re-deriving the message's best body when the caller already has it. */
function plainTextOf(objMessage: any, htmlBody?: string): string {
	return objMessage.plainTextAlternative() ?? htmlToPlainText(htmlBody ?? objMessage.bestBody());
}

/** The URL serving the inline attachment that a `cid:` reference in the given message points at. */
export function cidUrlFor(threadId: string, messageId: string, contentId: string): string {
	return `/api/threads/${threadId}/messages/${messageId}/cid/${encodeURIComponent(contentId)}`;
}

export function loadRelevantDataFromMessage(objMessage: any): ThreadMessageDto {
	const originalBody = objMessage.bestBody();
	const attachments = objMessage.getAttachments();
	const plainTextBody = plainTextOf(objMessage, originalBody);
	const wordCount = countWords(plainTextBody);
	const timeToReadSeconds = readTimeSecondsFor(wordCount);
	const html = sanitizeEmailHtml(originalBody, {
		cidUrl: (contentId) => cidUrlFor(objMessage.threadId(), objMessage.id(), contentId),
	});
	return normalizeThreadMessageDto({
		deleted: objMessage.labelIds().indexOf('TRASH') !== -1,
		messageId: objMessage.id(),
		from: [objMessage.sender()],
		senderVerification: verifySender(objMessage.headers(), objMessage.sender()?.email),
		to: objMessage.recipients(),
		date: objMessage.timestamp(),
		body: {
			original: originalBody,
			html,
			plainText: plainTextBody,
		},
		wordcount: wordCount,
		timeToReadSeconds: timeToReadSeconds,
		attachments: attachments,
	});
}
