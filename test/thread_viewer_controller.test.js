import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createThreadViewerController,
	normalizeBase64AttachmentData,
} from '../src/frontend/thread_viewer_controller.js';

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
	};
}

test('normalizeBase64AttachmentData converts Gmail-safe alphabet to standard base64', () => {
	assert.equal(normalizeBase64AttachmentData('ab-c_d'), 'ab+c/d');
});

test('openThread renders deleted-message notice and non-deleted messages', async () => {
	const rendered = [];
	const { controller, events } = createController();
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
		receivers: [{ name: 'Receiver', email: 'receiver@example.com' }],
		senders: [{ name: 'Sender', email: 'sender@example.com' }],
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
		['senders', [{ name: 'Sender', email: 'sender@example.com' }]],
		['receivers', [{ name: 'Receiver', email: 'receiver@example.com' }]],
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
	assert.deepEqual(events, [
		{ type: 'info', message: 'Downloading thread data for thread-1...' },
		{ type: 'success', message: 'Successfully downloaded thread data for thread-1.' },
	]);
});

test('replyAll validates thread context before sending', async () => {
	const apiCalls = [];
	const { controller, events } = createController({
		appApi: {
			async buildRfc2822() { apiCalls.push('buildRfc2822'); return { ok: true, value: 'raw' }; },
			async getAttachment() { throw new Error('unused'); },
			async sendMessage() { apiCalls.push('sendMessage'); return { ok: true, value: {} }; },
		},
	});

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
		error: new Error('Missing thread id or authenticated email address.'),
	});
	assert.deepEqual(events.at(-1), {
		type: 'error',
		message: 'Failed to send reply: Missing thread id or authenticated email address.',
	});
	assert.deepEqual(apiCalls, []);
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
	assert.deepEqual(events, [
		{ type: 'info', message: 'Sending reply...' },
		{ type: 'success', message: 'Reply sent.' },
	]);
});

for (const { name, buildRfc2822, sendMessage, expectedMessage } of [
	{
		name: 'building the message',
		buildRfc2822: { ok: false, error: new Error('Could not determine recipients for reply.') },
		sendMessage: { ok: true, value: { id: 'unused' } },
		expectedMessage: 'Failed to send reply: Could not determine recipients for reply.',
	},
	{
		name: 'sending the message',
		buildRfc2822: { ok: true, value: 'raw-message' },
		sendMessage: { ok: false, error: new TypeError('Failed to fetch') },
		expectedMessage: 'Failed to send reply: Failed to fetch',
	},
]) {
	test(`replyAll reports a failure ${name} and keeps the reply open`, async () => {
		const calls = [];
		const { controller, events } = createController({
			appApi: {
				async buildRfc2822() { return buildRfc2822; },
				async getAttachment() { throw new Error('unused'); },
				async sendMessage() { return sendMessage; },
			},
		});

		const result = await controller.replyAll({
			body: 'Reply body',
			clearReply() { calls.push('clearReply'); },
			emailAddress: 'me@example.com',
			hideModal() { calls.push('hideModal'); },
			inReplyTo: 'msg-1',
			threadId: 'thread-1',
		});

		assert.equal(result.ok, false);
		assert.deepEqual(calls, []);
		assert.deepEqual(events.at(-1), { type: 'error', message: expectedMessage });
	});
}

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

function openOptions(overrides = {}) {
	let currentThreadId = null;
	return {
		appendDeletedMessages() {},
		appendMessage() {},
		clearThreads() {},
		getCurrentThreadId() { return currentThreadId; },
		hideLoading() {},
		setReceivers() {},
		setSenders() {},
		setThreadId(value) { currentThreadId = value; },
		setThreadsLoadingText() {},
		setTitle() {},
		showLoading() {},
		showModal() {},
		threadId: 'thread-1',
		...overrides,
	};
}

test('openThread resolves the download announcement to a single error when fetching fails', async (t) => {
	t.mock.method(console, 'error', () => {});
	const { controller, events } = createController({
		getThreadData: async () => ({ ok: false, error: new Error('Thread not found') }),
	});

	await controller.openThread(openOptions());

	assert.deepEqual(events, [
		{ type: 'info', message: 'Downloading thread data for thread-1...' },
		{ type: 'error', message: 'Failed to download thread data for thread-1: Thread not found' },
	]);
});

test('openThread resolves the download announcement to an error when rendering throws', async (t) => {
	t.mock.method(console, 'error', () => {});
	const { controller, events } = createController();

	await controller.openThread(openOptions({ appendMessage() { throw new Error('render exploded'); } }));

	assert.deepEqual(events, [
		{ type: 'info', message: 'Downloading thread data for thread-1...' },
		{ type: 'error', message: 'Failed to download thread data for thread-1: render exploded' },
	]);
});

test('openThread resolves the announcement when another thread was opened meanwhile', async () => {
	const { controller, events } = createController();

	await controller.openThread(openOptions({ getCurrentThreadId() { return 'thread-2'; } }));

	assert.equal(events.length, 2);
	assert.equal(events[0].type, 'info');
	assert.equal(events[1].type, 'success');
});

test('replyAll resolves the announcement to an error and returns a failed Result when a callback throws', async (t) => {
	t.mock.method(console, 'error', () => {});
	const { controller, events } = createController();

	const result = await controller.replyAll({
		body: 'Reply body',
		clearReply() { throw new Error('clear exploded'); },
		emailAddress: 'me@example.com',
		hideModal() {},
		inReplyTo: 'msg-1',
		threadId: 'thread-1',
	});

	assert.equal(result.ok, false);
	assert.equal(result.error.message, 'clear exploded');
	assert.deepEqual(events.at(-1), { type: 'error', message: 'Failed to send reply: clear exploded' });
});

test('replyAll ignores a second call while one is in flight and accepts a new one afterwards', async (t) => {
	t.mock.method(console, 'warn', () => {});
	let sendCount = 0;
	let releaseSend;
	const sendGate = new Promise((resolve) => { releaseSend = resolve; });
	const { controller } = createController({
		appApi: {
			async buildRfc2822() { return { ok: true, value: 'raw' }; },
			async getAttachment() { throw new Error('unused'); },
			async sendMessage() { sendCount++; await sendGate; return { ok: true, value: { id: 'sent' } }; },
		},
	});
	const options = {
		body: 'Reply body',
		clearReply() {},
		emailAddress: 'me@example.com',
		hideModal() {},
		inReplyTo: 'msg-1',
		threadId: 'thread-1',
	};

	const first = controller.replyAll(options);
	const second = await controller.replyAll(options);
	releaseSend();
	const firstResult = await first;
	const third = await controller.replyAll(options);

	assert.equal(second.ok, false);
	assert.equal(firstResult.ok, true);
	assert.equal(third.ok, true);
	assert.equal(sendCount, 2);
});
