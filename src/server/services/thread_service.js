import assert from 'assert';
import util from 'util';

import sanitizeHtml from 'sanitize-html';
import htmlEntities from 'html-entities';
import nebulog from 'nebulog';

import modelsMessage from '../../../models/message.js';
import threadRepository from '../repositories/thread_repository.js';
import {
	makeValidationError,
	normalizeThreadMessageDto,
	normalizeThreadSummaryDto,
	validateThreadPayload,
} from '../validation/contracts.js';

const Entities = htmlEntities.AllHtmlEntities;
const entities = new Entities();
const logger = nebulog.make({filename: 'src/server/services/thread_service.js', level: 'info'});

export function createThreadService(dependencies = {}) {
	const repository = dependencies.threadRepository || threadRepository;

	async function saveThreadPayload({
		threadPayload,
		lastRefresheds,
	}) {
		try {
			validateThreadPayload(threadPayload);
		} catch (error) {
			if (error.code === 'INVALID_CONTRACT') {
				return {
					status: 400,
					body: {humanErrorMessage: error.message},
				};
			}
			throw error;
		}

		const threadId = threadPayload.id;
		if (!threadId.match(/^[0-9a-z]+$/)) {
			return {
				status: 400,
				body: {humanErrorMessage: 'invalid threadId'},
			};
		}

		const allMessagesInTrash = threadPayload.messages.every(
			(message) => message.labelIds.indexOf('TRASH') !== -1
		);
		if (allMessagesInTrash) {
			logger.info(`Deleting thread ${threadId} because all messages in thread are in trash.`);
			return {
				status: await repository.deleteThread(threadId) ? 200 : 500,
			};
		}

		threadPayload.messages.forEach((messageData) => {
			const messageInstance = new modelsMessage.Message(messageData);
			const originalBody = messageInstance.bestBody();
			const plainTextBody = sanitizeHtml(originalBody, {allowedTags: [], allowedAttributes: {}});
			const wordCount = plainTextBody.split(' ').filter((word) => word.length > 0).length;
			const timeToReadSeconds = Math.round((wordCount * 60) / 200);
			messageData.calculatedWordCount = wordCount;
			messageData.calculatedTimeToReadSeconds = timeToReadSeconds;
		});

		const existingData = await repository.readThreadJson(threadId);
		const newData = threadPayload;
		if (existingData && existingData.messages) {
			newData.messages.forEach((newMessage) => {
				const existingMessage = existingData.messages.find((message) => message.id === newMessage.id);
				if (existingMessage && existingMessage.fullBodyWordCount) {
					newMessage.fullBodyWordCount = existingMessage.fullBodyWordCount;
				}
			});
		}

		await repository.saveThreadJson(threadId, newData);
		lastRefresheds.markRefreshed(threadId).catch((saveError) => {
			logger.error(util.format('Failed to save last refreshed for %s: %s', threadId, util.inspect(saveError)));
		});
		return {status: 200};
	}

	async function getMostRelevantThreads({
		hideUntils,
		lastRefresheds,
		limit = 100,
	}) {
		const filenames = await repository.listThreadIds();
		const now = Date.now();
		let formattedThreads = await Promise.all(filenames.map(async (filename) => {
			try {
				const thread = await repository.readThread(filename);
				const maybeMostRecentSnippetInThread = thread.snippet();
				assert((typeof thread.id()) === 'string', `Expected thread.id() to be a string but was ${typeof thread.threadId} for file ${filename}.`);

				let totalTimeToReadSecondsForThread = 0;
				const messagesInThread = thread.messages();
				messagesInThread.forEach((message) => {
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
					snippet: maybeMostRecentSnippetInThread ? entities.decode(maybeMostRecentSnippetInThread) : null,
					messageIds: thread.messageIds(),
					labelIds: thread.labelIds(),
					visibility: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).getVisibility(thread.lastUpdated(), now),
					isWhenIHaveTime: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).isWhenIHaveTime(),
					needsRefreshing: lastRefresheds.needsRefreshing(thread.id(), thread.lastUpdated(), now),
					totalTimeToReadSeconds: totalTimeToReadSecondsForThread,
					recentMessageReadTimeSeconds: recentMessageReadTime,
				});
			} catch (error) {
				logger.warn(`Couldn't read certain threads in getMostRelevantThreads. Ignoring and continuing. ${util.inspect(error)}`);
				return null;
			}
		}));

		formattedThreads = formattedThreads
			.filter((formattedThread) => formattedThread !== null)
			.filter((formattedThread) => formattedThread.visibility !== 'hidden');
		formattedThreads.sort(hideUntils.comparator());
		formattedThreads.length = Math.min(formattedThreads.length, limit);
		return formattedThreads;
	}

	async function getThreadMessages(threadId) {
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
	}) {
		if (!(typeof threadId === 'string' && typeof messageId === 'string')) {
			throw makeValidationError('threadId and messageId must be strings');
		}
		const thread = await repository.readThread(threadId);
		const message = thread.message(messageId);
		if (!message) {
			return {status: 404};
		}
		message._data.fullBodyWordCount = parseInt(wordcount, 10);
		await repository.saveThreadJson(threadId, thread._data);
		return {status: 200};
	}

	async function getThreadMessage(threadId, messageId) {
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

const threadService = createThreadService();

export function loadRelevantDataFromMessage(objMessage) {
	const originalBody = objMessage.bestBody();
	const attachments = objMessage.getAttachments();
	const plainTextBody = sanitizeHtml(originalBody, {
		allowedTags: [],
		allowedAttributes: {}
	});
	const wordCount = plainTextBody.split(' ').length;
	const timeToReadSeconds = wordCount * 60 / 200;
	const sanitizedBody = sanitizeHtml(originalBody, {
		transformTags: {
			'body': 'div',
			'a': function(tagName, attribs) {
				if (attribs.href) {
					attribs.target = '_blank';
				}
				return {
					tagName: 'a',
					attribs: attribs
				};
			},
			'*': function(tagName, attribs) {
				if ((typeof attribs.style) === 'string') {
					attribs.style = attribs.style.replace(/position: *absolute;/, '');
					return {
						tagName: tagName,
						attribs: attribs
					};
				}
				return {
					tagName: tagName,
					attribs: attribs
				};
			}
		},
		allowedTags: [
			'a', 'area', 'b', 'blockquote', 'br', 'caption', 'center', 'code',
			'div', 'em',
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
			'hr', 'i', 'img', 'li', 'map', 'nl', 'ol', 'p', 'pre', 'span',
			'strike', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
		allowedAttributes: {
			a: ['href', 'name', 'style', 'target'],
			area: ['href', 'shape', 'coords', 'style', 'target'],
			div: ['style'],
			img: ['alt', 'border', 'height', 'src', 'style', 'usemap', 'width'],
			map: ['name'],
			p: ['style'],
			span: ['style'],
			table: ['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'style', 'width'],
			td: ['align', 'background', 'bgcolor', 'colspan', 'height', 'rowspan', 'style', 'valign', 'width'],
		},
		nonTextTags: ['style', 'script', 'textarea', 'title']
	});
	return normalizeThreadMessageDto({
		deleted: objMessage.labelIds().indexOf('TRASH') !== -1,
		messageId: objMessage.id(),
		from: [objMessage.sender()],
		to: objMessage.recipients(),
		date: objMessage.timestamp(),
		body: {
			original: originalBody,
			sanitized: sanitizedBody,
			plainText: plainTextBody,
		},
		wordcount: plainTextBody.split(' ').length,
		timeToReadSeconds: timeToReadSeconds,
		attachments: attachments
	});
}

export default threadService;
