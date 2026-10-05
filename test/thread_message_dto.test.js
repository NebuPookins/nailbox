import test from 'node:test';
import assert from 'node:assert/strict';

import {Message} from '../models/message.js';
import {loadRelevantDataFromMessage} from '../src/server/services/thread_service.js';

const base64 = (text) => Buffer.from(text).toString('base64url');

function message(payload) {
	return new Message({
		id: 'm1',
		threadId: 't1',
		labelIds: ['INBOX'],
		snippet: '',
		internalDate: '1000',
		payload: {headers: [{name: 'From', value: 'Al <al@example.com>'}], body: {size: 0}, ...payload},
	});
}

test('message DTO exposes safe html with cid images pointing at the message cid route', () => {
	const dto = loadRelevantDataFromMessage(message({
		mimeType: 'text/html',
		body: {size: 1, data: base64('<style>p{color:red}</style><p>Hi</p><img src="cid:logo@x"><script>x()</script>')},
	}));
	assert.match(dto.body.html, /<style>p\{color:red\}<\/style>/);
	assert.match(dto.body.html, /src="\/api\/threads\/t1\/messages\/m1\/cid\/logo%40x"/);
	assert.doesNotMatch(dto.body.html, /script/);
});

test('message DTO prefers the text/plain alternative for plainText and counts its words', () => {
	const dto = loadRelevantDataFromMessage(message({
		mimeType: 'multipart/alternative',
		parts: [
			{mimeType: 'text/plain', body: {size: 5, data: base64('one two\nthree four')}},
			{mimeType: 'text/html', body: {size: 50, data: base64('<p>something else entirely</p>')}},
		],
	}));
	assert.equal(dto.body.plainText, 'one two\nthree four');
	assert.equal(dto.wordcount, 4);
});

test('message DTO derives plainText from HTML when there is no text/plain alternative', () => {
	const dto = loadRelevantDataFromMessage(message({
		mimeType: 'text/html',
		body: {size: 1, data: base64('<p>First</p><p>Second<br>third</p>')},
	}));
	assert.equal(dto.body.plainText, 'First\n\nSecond\nthird');
	assert.equal(dto.wordcount, 3);
});

test('message DTO marks the sender verified when Gmail reports an aligned DMARC pass', () => {
	const dto = loadRelevantDataFromMessage(message({
		headers: [
			{name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass (p=NONE) header.from=example.com'},
			{name: 'From', value: 'Al <al@example.com>'},
		],
		mimeType: 'text/plain',
		body: {size: 2, data: base64('hi')},
	}));
	assert.equal(dto.senderVerification, 'verified');
});

test('message DTO marks the sender unverified when Gmail gave no verdict', () => {
	const dto = loadRelevantDataFromMessage(message({
		mimeType: 'text/plain',
		body: {size: 2, data: base64('hi')},
	}));
	assert.equal(dto.senderVerification, 'unverified');
});
