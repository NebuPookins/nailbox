import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createThreadViewerController,
	normalizeBase64AttachmentData,
} from '../src/frontend/thread_viewer_controller.js';

globalThis.moment = {
	duration(value, unit) {
		assert.equal(unit, 'seconds');
		return {
			humanize() {
				if (value === 90) {
					return '2 minutes';
				}
				return `${value} seconds`;
			},
		};
	},
};

function createMessengerGetter() {
	const events = [];
	return {
		events,
		messengerGetter() {
			return {
				error(message) {
					events.push({
						type: 'error',
						message,
					});
				},
				info(message) {
					events.push({
						type: 'info',
						message,
					});
					return {
						update(payload) {
							events.push(payload);
						},
					};
				},
			};
		},
	};
}

function createController(overrides = {}) {
	const { events, messengerGetter } = createMessengerGetter();
	const wordcountUpdates = [];
	const controller = createThreadViewerController({
		appApi: overrides.appApi || {
			async buildRfc2822() {
				return { ok: true, value: 'base64-message' };
			},
			async getAttachment() {
				return { ok: true, value: { data: 'aGVsbG8=' } };
			},
			async sendMessage() {
				return { ok: true, value: { id: 'sent-123' } };
			},
		},
		getThreadData: overrides.getThreadData || (async () => ({ ok: true, value: {
			messages: [
				{
					deleted: true,
					messageId: 'deleted-1',
					timeToReadSeconds: 0,
					wordcount: 0,
				},
				{
					deleted: false,
					messageId: 'msg-1',
					timeToReadSeconds: 90,
					wordcount: 123,
				},
			],
		}})),
		messengerGetter,
		onUpdateMessageWordcount(threadId, messageId, wordcount) {
			wordcountUpdates.push({ threadId, messageId, wordcount });
			return Promise.resolve();
		},
		threadActionController: overrides.threadActionController || {
			async archiveThread(threadId) {
				return { ok: Boolean(threadId) };
			},
			async deleteThread(threadId) {
				return { ok: Boolean(threadId) };
			},
		},
	});
	return {
		controller,
		events,
		wordcountUpdates,
	};
}

test('normalizeBase64AttachmentData converts Gmail-safe alphabet to standard base64', () => {
	assert.equal(normalizeBase64AttachmentData('ab-c_d'), 'ab+c/d');
});

test('openThread renders deleted-message notice and non-deleted messages', async () => {
	const rendered = [];
	const { controller, events, wordcountUpdates } = createController();
	let currentThreadId = null;

	await controller.openThread({
		appendDeletedMessages(payload) {
			rendered.push(['deleted', payload]);
		},
		appendMessage(message) {
			rendered.push(['message', message]);
		},
		clearThreads() {
			rendered.push(['clear']);
		},
		getCurrentThreadId() {
			return currentThreadId;
		},
		hideLoading() {
			rendered.push(['hideLoading']);
		},
		receiversText: 'Receiver',
		sendersText: 'Sender',
		setReceivers(value) {
			rendered.push(['receivers', value]);
		},
		setSenders(value) {
			rendered.push(['senders', value]);
		},
		setThreadId(value) {
			currentThreadId = value;
			rendered.push(['threadId', value]);
		},
		setThreadsLoadingText(value) {
			rendered.push(['snippet', value]);
		},
		setTitle(value) {
			rendered.push(['title', value]);
		},
		showLoading() {
			rendered.push(['showLoading']);
		},
		showModal() {
			rendered.push(['showModal']);
		},
		snippet: 'Loading snippet',
		subject: 'Subject',
		threadId: 'thread-1',
	});

	assert.deepEqual(rendered, [
		['threadId', 'thread-1'],
		['title', 'Subject'],
		['senders', 'Sender'],
		['receivers', 'Receiver'],
		['snippet', 'Loading snippet'],
		['showLoading'],
		['showModal'],
		['hideLoading'],
		['clear'],
		['deleted', { num: 1, threadId: 'thread-1' }],
		['message', {
			deleted: false,
			duration: '2 minutes',
			messageId: 'msg-1',
			timeToReadSeconds: 90,
			wordcount: 123,
		}],
	]);
	assert.deepEqual(wordcountUpdates, [
		{ threadId: 'thread-1', messageId: 'msg-1', wordcount: 123 },
	]);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Downloading thread data for thread-1...' },
		{ type: 'success', message: 'Successfully downloaded thread data for thread-1.' },
	]);
});

test('replyAll validates thread context before sending', async () => {
	const { controller, events } = createController();

	const result = await controller.replyAll({
		body: 'Reply body',
		clearReply() {},
		emailAddress: '',
		hideModal() {},
		inReplyTo: 'msg-1',
		threadId: 'thread-1',
	});

	assert.deepEqual(result, {
		ok: false,
		error: 'Missing thread id or authenticated email address.',
	});
	assert.deepEqual(events, []);
});

test('replyAll builds and sends the message, then clears and closes the modal', async () => {
	const calls = [];
	const { controller, events } = createController({
		appApi: {
			async buildRfc2822(payload) {
				calls.push(['build', payload]);
				return { ok: true, value: 'raw-message' };
			},
			async getAttachment() {
				throw new Error('unused');
			},
			async sendMessage(payload) {
				calls.push(['send', payload]);
				return { ok: true, value: { id: 'gmail-1' } };
			},
		},
	});

	const result = await controller.replyAll({
		body: 'Reply body',
		clearReply() {
			calls.push(['clearReply']);
		},
		emailAddress: 'me@example.com',
		hideModal() {
			calls.push(['hideModal']);
		},
		inReplyTo: 'msg-99',
		threadId: 'thread-1',
	});

	assert.deepEqual(result, {
		ok: true,
		value: {
			messageId: 'gmail-1',
		},
	});
	assert.deepEqual(calls, [
		['build', {
			myEmail: 'me@example.com',
			threadId: 'thread-1',
			body: 'Reply body',
			inReplyTo: 'msg-99',
		}],
		['send', {
			threadId: 'thread-1',
			raw: 'raw-message',
		}],
		['clearReply'],
		['hideModal'],
	]);
	assert.deepEqual(events, []);
});

test('handleKeydown deletes the current thread on Delete when reply is not focused', async () => {
	const calls = [];
	const { controller } = createController({
		threadActionController: {
			async archiveThread() {
				throw new Error('unused');
			},
			async deleteThread(threadId) {
				calls.push(['delete', threadId]);
				return { ok: true };
			},
		},
	});

	await controller.handleKeydown({
		event: { key: 'Delete' },
		hideModal() {
			calls.push(['hideModal']);
		},
		isReplyFocused() {
			return false;
		},
		threadId: 'thread-1',
	});

	assert.deepEqual(calls, [
		['delete', 'thread-1'],
		['hideModal'],
	]);
});
