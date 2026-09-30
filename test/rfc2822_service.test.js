import test from 'node:test';
import assert from 'node:assert/strict';

import { Message } from '../models/message.js';
import { createRfc2822Service } from '../src/server/services/rfc2822_service.js';

function createLogger() {
	return {
		error() {},
		warn() {},
	};
}

test('buildRfc2822Message includes recipients from thread participants', async () => {
	const messageId = '<message-1@example.com>';
	const replyMessage = {
		header(name) {
			if (name === 'Message-ID') {
				return { value: messageId };
			}
			return null;
		},
		recipients() {
			return [{ name: 'Me', email: 'me@example.com' }];
		},
		replyTo() {
			return { name: 'Bob', email: 'bob@example.com' };
		},
	};
	const thread = {
		message(id) {
			return id === 'message-1' ? replyMessage : null;
		},
		recipients() {
			return [{ name: 'Me', email: 'me@example.com' }];
		},
		senders() {
			return [{ name: 'Bob', email: 'bob@example.com' }];
		},
		subject() {
			return 'Test subject';
		},
	};
	const service = createRfc2822Service({
		threadRepository: {
			async readThread() {
				return thread;
			},
		},
	});

	const encoded = await service.buildRfc2822Message({
		threadId: 'thread-1',
		body: 'Hello world',
		inReplyTo: 'message-1',
		myEmail: 'me@example.com',
		logger: createLogger(),
	});
	const mimeText = Buffer.from(encoded, 'base64url').toString('utf8');

	assert.match(mimeText, /To: Bob <bob@example\.com>/);
	assert.match(mimeText, /In-Reply-To: <message-1@example\.com>/);
});

test('buildRfc2822Message rejects replies with no recipient other than myself', async () => {
	const replyMessage = {
		header() {
			return null;
		},
		replyTo() {
			return { name: 'Me', email: 'me@example.com' };
		},
	};
	const thread = {
		message() {
			return replyMessage;
		},
		recipients() {
			return [{ name: 'Me', email: 'me@example.com' }];
		},
		senders() {
			return [{ name: 'Me', email: 'me@example.com' }];
		},
	};
	const service = createRfc2822Service({
		threadRepository: {
			async readThread() {
				return thread;
			},
		},
	});

	await assert.rejects(() => service.buildRfc2822Message({
		threadId: 'thread-1',
		body: 'Hello world',
		inReplyTo: 'message-1',
		myEmail: 'me@example.com',
		logger: createLogger(),
	}), {
		status: 400,
		message: 'Could not determine recipients for reply.',
	});
});

async function buildReplyMimeText(headers) {
	const replyMessage = new Message({
		id: 'message-2',
		threadId: 'thread-1',
		labelIds: ['INBOX'],
		snippet: '',
		internalDate: '0',
		payload: {
			mimeType: 'text/plain',
			body: { size: 0 },
			headers: [{ name: 'From', value: 'Bob <bob@example.com>' }, ...headers],
		},
	});
	const thread = {
		message(id) {
			return id === 'message-2' ? replyMessage : null;
		},
		recipients() {
			return [{ name: 'Me', email: 'me@example.com' }];
		},
		senders() {
			return [{ name: 'Bob', email: 'bob@example.com' }];
		},
		subject() {
			return 'Test subject';
		},
	};
	const service = createRfc2822Service({
		threadRepository: {
			async readThread() {
				return thread;
			},
		},
	});
	const encoded = await service.buildRfc2822Message({
		threadId: 'thread-1',
		body: 'Hello world',
		inReplyTo: 'message-2',
		myEmail: 'me@example.com',
		logger: createLogger(),
	});
	return Buffer.from(encoded, 'base64url').toString('utf8');
}

test('buildRfc2822Message extends the parent References chain with its Message-ID', async () => {
	const mimeText = await buildReplyMimeText([
		{ name: 'Message-ID', value: '<message-2@example.com>' },
		{ name: 'In-Reply-To', value: '<message-1@example.com>' },
		{ name: 'References', value: '<message-0@example.com> <message-1@example.com>' },
	]);

	assert.match(mimeText, /In-Reply-To: <message-2@example\.com>/);
	assert.match(mimeText, /References: <message-0@example\.com> <message-1@example\.com>\s+<message-2@example\.com>/);
});

test('buildRfc2822Message falls back to the parent In-Reply-To when it has no References', async () => {
	const mimeText = await buildReplyMimeText([
		{ name: 'Message-ID', value: '<message-2@example.com>' },
		{ name: 'In-Reply-To', value: '<message-1@example.com>' },
	]);

	assert.match(mimeText, /References: <message-1@example\.com>\s+<message-2@example\.com>/);
});

test('buildRfc2822Message matches the parent Message-ID header case-insensitively', async () => {
	const mimeText = await buildReplyMimeText([
		{ name: 'Message-Id', value: '<message-2@example.com>' },
	]);

	assert.match(mimeText, /In-Reply-To: <message-2@example\.com>/);
	assert.match(mimeText, /References: <message-2@example\.com>/);
});

test('buildRfc2822Message reads the parent Reply-To header case-insensitively', async () => {
	const mimeText = await buildReplyMimeText([
		{ name: 'reply-to', value: 'Carol <carol@example.com>' },
	]);

	assert.match(mimeText, /carol@example\.com/);
});

test('buildRfc2822Message omits threading headers when the parent has no Message-ID', async () => {
	const mimeText = await buildReplyMimeText([]);

	assert.doesNotMatch(mimeText, /In-Reply-To:/);
	assert.doesNotMatch(mimeText, /References:/);
});
