import test from 'node:test';
import assert from 'node:assert/strict';

import { Thread } from '../models/thread.js';
import { createRfc2822Service } from '../src/server/services/rfc2822_service.js';

function createLogger() {
	return {
		error() {},
		warn() {},
	};
}

const FROM_BOB = { name: 'From', value: 'Bob <bob@example.com>' };
const FROM_ME = { name: 'From', value: 'Me <me@example.com>' };

// Builds a reply to a single-message thread with the given headers, and resolves
// to the decoded MIME text (or rejects as the service does).
async function buildReply({
	headers = [FROM_BOB, { name: 'To', value: 'Me <me@example.com>' }],
	body = 'Hello world',
} = {}) {
	const thread = new Thread({
		id: 'thread-1',
		messages: [{
			id: 'message-1',
			threadId: 'thread-1',
			labelIds: [],
			snippet: '',
			internalDate: '0',
			payload: { mimeType: 'text/plain', body: { size: 0 }, headers },
		}],
	});
	const service = createRfc2822Service({
		threadRepository: { async readThread() { return thread; } },
	});
	const encoded = await service.buildRfc2822Message({
		threadId: 'thread-1',
		body,
		inReplyTo: 'message-1',
		myEmail: 'me@example.com',
		logger: createLogger(),
	});
	return Buffer.from(encoded, 'base64url').toString('utf8');
}

test('buildRfc2822Message includes recipients from thread participants', async () => {
	const mimeText = await buildReply({
		headers: [
			FROM_BOB,
			{ name: 'To', value: 'Me <me@example.com>' },
			{ name: 'Message-ID', value: '<message-1@example.com>' },
		],
	});

	assert.match(mimeText, /To: Bob <bob@example\.com>/);
	assert.match(mimeText, /In-Reply-To: <message-1@example\.com>/);
});

test('buildRfc2822Message addresses the reply to myself when the message was sent only to me', async () => {
	const mimeText = await buildReply({
		headers: [FROM_ME, { name: 'To', value: 'Me <ME@example.com>' }],
	});

	assert.match(mimeText, /^To: Me <me@example\.com>\r?$/m);
});

for (const { name, headers } of [
	{
		name: 'everyone else was on Bcc',
		headers: [
			FROM_ME,
			{ name: 'To', value: 'Me <me@example.com>' },
			{ name: 'Bcc', value: 'Bob <bob@example.com>' },
		],
	},
	{
		name: 'To is an undisclosed-recipients group',
		headers: [FROM_ME, { name: 'To', value: 'undisclosed-recipients:;' }],
	},
	{
		name: 'there is no To header',
		headers: [FROM_ME],
	},
]) {
	test(`buildRfc2822Message does not silently reply to myself when ${name}`, async () => {
		await assert.rejects(buildReply({ headers }), {
			status: 400,
			message: /no recipients other than you are visible/,
		});
	});
}

test('buildRfc2822Message rejects replies when the thread has no participants', async () => {
	await assert.rejects(buildReply({ headers: [] }), {
		status: 400,
		message: /Could not determine recipients for reply/,
	});
});

test('buildRfc2822Message extends the parent References chain with its Message-ID', async () => {
	const mimeText = await buildReply({
		headers: [
			FROM_BOB,
			{ name: 'Message-ID', value: '<message-2@example.com>' },
			{ name: 'In-Reply-To', value: '<message-1@example.com>' },
			{ name: 'References', value: '<message-0@example.com> <message-1@example.com>' },
		],
	});

	assert.match(mimeText, /In-Reply-To: <message-2@example\.com>/);
	assert.match(mimeText, /References: <message-0@example\.com> <message-1@example\.com>\s+<message-2@example\.com>/);
});

test('buildRfc2822Message falls back to the parent In-Reply-To when it has no References', async () => {
	const mimeText = await buildReply({
		headers: [
			FROM_BOB,
			{ name: 'Message-ID', value: '<message-2@example.com>' },
			{ name: 'In-Reply-To', value: '<message-1@example.com>' },
		],
	});

	assert.match(mimeText, /References: <message-1@example\.com>\s+<message-2@example\.com>/);
});

test('buildRfc2822Message matches the parent Message-ID header case-insensitively', async () => {
	const mimeText = await buildReply({
		headers: [FROM_BOB, { name: 'Message-Id', value: '<message-2@example.com>' }],
	});

	assert.match(mimeText, /In-Reply-To: <message-2@example\.com>/);
	assert.match(mimeText, /References: <message-2@example\.com>/);
});

test('buildRfc2822Message reads the parent Reply-To header case-insensitively', async () => {
	const mimeText = await buildReply({
		headers: [FROM_BOB, { name: 'reply-to', value: 'Carol <carol@example.com>' }],
	});

	assert.match(mimeText, /carol@example\.com/);
});

test('buildRfc2822Message omits threading headers when the parent has no Message-ID', async () => {
	const mimeText = await buildReply();

	assert.doesNotMatch(mimeText, /In-Reply-To:/);
	assert.doesNotMatch(mimeText, /References:/);
});

test('buildRfc2822Message accepts code fences tagged with a language highlight.js does not know', async () => {
	const mimeText = await buildReply({ body: '```notalanguage\nconst x = 1;\n```' });

	assert.match(mimeText, /const x = 1;/);
});

test('buildRfc2822Message escapes a code fence language tag in the HTML body', async () => {
	const mimeText = await buildReply({ body: '```a"onmouseover="x\ncode\n```' });

	assert.doesNotMatch(mimeText, /language-a"onmouseover/);
});

function decodeQuotedPrintable(text) {
	return text
		.replace(/=\r?\n/g, '')
		.replace(/=([0-9A-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

test('buildRfc2822Message inlines syntax highlighting styles in the HTML body', async () => {
	const html = decodeQuotedPrintable(await buildReply({ body: '```js\nconst x = "hi";\n```' }));

	assert.match(html, /<pre style="background:#002b36; ?color:#839496"><code class="language-js">/);
	assert.match(html, /<span class="hljs-keyword" style="color:#859900">const<\/span>/);
	assert.match(html, /<span class="hljs-string" style="color:#2aa198">/);
});

test('buildRfc2822Message keeps links in any scheme and raw HTML comments in the HTML body', async () => {
	const html = decodeQuotedPrintable(await buildReply({ body: '[call me](sms:123) ![logo](cid:logo@x)\n\n<!-- note -->' }));

	assert.match(html, /<a href="sms:123">call me<\/a>/);
	assert.match(html, /<img src="cid:logo@x" alt="logo"/);
	assert.match(html, /<!-- note -->/);
});
