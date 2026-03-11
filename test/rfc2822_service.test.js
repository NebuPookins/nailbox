import test from 'node:test';
import assert from 'node:assert/strict';

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
