import assert from 'assert';
import util from 'util';

import {decode} from 'html-entities';
import nebulog from 'nebulog';

import {removeThreadFromBundle} from '../../../models/bundle.js';
import {countWords, htmlToPlainText, sanitizeEmailHtml} from './email_html.js';
import {verifySender} from './sender_verification.js';
import {
	isInInbox,
	isThreadId,
	makeValidationError,
	normalizeThreadMessageDto,
	normalizeThreadSummaryDto,
	validateThreadPayload,
} from '../validation/contracts.js';
import type {ThreadSummaryDto, ThreadMessageDto} from '../types/thread.js';

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

	async function saveThreadPayload({
		threadPayload,
		lastRefresheds,
	}: {
		threadPayload: any;
		lastRefresheds: any;
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
			const existingData = await repository.readThreadJson(threadId);
			logger.info(`Deleting thread ${threadId} because no message in the thread is in the inbox.`);
			const deleted = await repository.deleteThread(threadId);
			if (deleted && bundles) {
				await removeThreadFromBundle(bundles, threadId);
			}
			return {
				status: deleted ? 200 : 500,
				changed: deleted && Boolean(existingData && Object.keys(existingData).length > 0),
			};
		}

		// Gmail bumps a thread's historyId on every change, so a matching one
		// means the cached copy is current and needn't be re-read or rewritten.
		if (threadPayload.historyId && await repository.readHistoryId(threadId) === threadPayload.historyId) {
			markRefreshed(lastRefresheds, threadId);
			return {status: 200, changed: false};
		}

		const existingData = await repository.readThreadJson(threadId);

		threadPayload.messages.forEach((messageData: any) => {
			const messageInstance = new MessageClass(messageData);
			const wordCount = countWords(plainTextOf(messageInstance));
			const timeToReadSeconds = Math.round((wordCount * 60) / 200);
			messageData.calculatedWordCount = wordCount;
			messageData.calculatedTimeToReadSeconds = timeToReadSeconds;
		});

		const newData = threadPayload;
		if (existingData && existingData.messages) {
			newData.messages.forEach((newMessage: any) => {
				const existingMessage = existingData.messages.find((message: any) => message.id === newMessage.id);
				if (existingMessage && existingMessage.fullBodyWordCount) {
					newMessage.fullBodyWordCount = existingMessage.fullBodyWordCount;
				}
			});
		}

		const didChange = !util.isDeepStrictEqual(existingData, newData);
		if (didChange) {
			await repository.saveThreadJson(threadId, newData);
		}
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
		const filenames: string[] = await repository.listThreadIds();
		const now = Date.now();
		const rawThreads: (ThreadSummaryDto | null)[] = await Promise.all(filenames.map(async (filename: string) => {
			try {
				const thread = await repository.readThread(filename);
				const maybeMostRecentSnippetInThread = thread.snippet();
				assert((typeof thread.id()) === 'string', `Expected thread.id() to be a string but was ${typeof thread.threadId} for file ${filename}.`);

				let totalTimeToReadSecondsForThread = 0;
				const messagesInThread = thread.messages();
				messagesInThread.forEach((message: any) => {
					totalTimeToReadSecondsForThread += message.getBestReadTimeSeconds();
				});

				let recentMessageReadTime = 0;
				if (messagesInThread.length > 0) {
					let mostRecentMessage = messagesInThread[0];
					for (let i = 1; i < messagesInThread.length; i += 1) {
						if (parseInt(messagesInThread[i].getInternalDate(), 10) > parseInt(mostRecentMessage.getInternalDate(), 10)) {
							mostRecentMessage = messagesInThread[i];
						}
					}
					recentMessageReadTime = mostRecentMessage.getBestReadTimeSeconds();
				}

				return normalizeThreadSummaryDto({
					threadId: thread.id(),
					senders: thread.senders(),
					receivers: thread.recipients(),
					lastUpdated: thread.lastUpdated(),
					subject: thread.subject(),
					snippet: maybeMostRecentSnippetInThread ? decode(maybeMostRecentSnippetInThread) : null,
					messageIds: thread.messageIds(),
					labelIds: thread.labelIds(),
					visibility: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).getVisibility(thread.lastUpdated(), now),
					isWhenIHaveTime: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).isWhenIHaveTime(),
					totalTimeToReadSeconds: totalTimeToReadSecondsForThread,
					recentMessageReadTimeSeconds: recentMessageReadTime,
				});
			} catch (error) {
				logger.warn(`Couldn't read certain threads in getMostRelevantThreads. Ignoring and continuing. filename=${filename} ${util.inspect(error)}`);
				return null;
			}
		}));

		const formattedThreads = rawThreads
			.filter((x): x is ThreadSummaryDto => x !== null)
			.filter((x) => x.visibility !== 'hidden');
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

	async function updateMessageWordCount({
		threadId,
		messageId,
		wordcount,
	}: {
		threadId: string;
		messageId: string;
		wordcount: number;
	}): Promise<{status: number}> {
		if (!(typeof threadId === 'string' && typeof messageId === 'string')) {
			throw makeValidationError('threadId and messageId must be strings');
		}
		const thread = await repository.readThread(threadId);
		const message = thread.message(messageId);
		if (!message) {
			return {status: 404};
		}
		message._data.fullBodyWordCount = parseInt(String(wordcount), 10);
		await repository.saveThreadJson(threadId, thread._data);
		return {status: 200};
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
		updateMessageWordCount,
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
	const timeToReadSeconds = wordCount * 60 / 200;
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
