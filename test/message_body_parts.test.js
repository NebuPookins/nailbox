import test from 'node:test';
import assert from 'node:assert/strict';

import {Message} from '../models/message.js';

const base64 = (text) => Buffer.from(text).toString('base64url');

function messageWith(payload) {
	return new Message({
		id: 'm1',
		threadId: 't1',
		labelIds: [],
		snippet: '',
		internalDate: '1',
		payload: {headers: [], body: {size: 0}, ...payload},
	});
}

test('plainTextAlternative returns the decoded text/plain part next to an HTML part', () => {
	const message = messageWith({
		mimeType: 'multipart/alternative',
		parts: [
			{mimeType: 'text/plain', body: {size: 5, data: base64('Hello there')}},
			{mimeType: 'text/html', body: {size: 20, data: base64('<p>Hello</p>')}},
		],
	});
	assert.equal(message.plainTextAlternative(), 'Hello there');
});

test('plainTextAlternative is null when the message is HTML only', () => {
	const message = messageWith({mimeType: 'text/html', body: {size: 3, data: base64('<p>x</p>')}});
	assert.equal(message.plainTextAlternative(), null);
});

test('plainTextAlternative ignores a mailing-list footer appended to an HTML-only message', () => {
	const message = messageWith({
		mimeType: 'multipart/mixed',
		parts: [
			{mimeType: 'text/html', body: {size: 30, data: base64('<p>The actual post</p>')}},
			{mimeType: 'text/plain', body: {size: 300, data: base64('Unsubscribe at https://lists.example.com')}},
		],
	});
	assert.equal(message.plainTextAlternative(), null);
});

test('plainTextAlternative takes the outer body, not a larger forwarded message', () => {
	const message = messageWith({
		mimeType: 'multipart/mixed',
		parts: [
			{
				mimeType: 'multipart/alternative',
				parts: [
					{mimeType: 'text/plain', body: {size: 4, data: base64('FYI')}},
					{mimeType: 'text/html', body: {size: 10, data: base64('<p>FYI</p>')}},
				],
			},
			{
				mimeType: 'message/rfc822',
				parts: [{mimeType: 'text/plain', body: {size: 5000, data: base64('The long forwarded email')}}],
			},
		],
	});
	assert.equal(message.plainTextAlternative(), 'FYI');
});

test('plainTextAlternative finds the plain part beside HTML wrapped with its inline images', () => {
	const message = messageWith({
		mimeType: 'multipart/alternative',
		parts: [
			{mimeType: 'text/plain', body: {size: 5, data: base64('Hello')}},
			{
				mimeType: 'multipart/related',
				parts: [
					{mimeType: 'text/html', body: {size: 20, data: base64('<p>Hello</p>')}},
					{mimeType: 'image/png', body: {size: 100, attachmentId: 'img1'}},
				],
			},
		],
	});
	assert.equal(message.plainTextAlternative(), 'Hello');
});

test('plainTextAlternative ignores text attachments', () => {
	const message = messageWith({
		mimeType: 'multipart/mixed',
		parts: [
			{mimeType: 'text/html', body: {size: 3, data: base64('<p>x</p>')}},
			{mimeType: 'text/plain', filename: 'notes.txt', body: {size: 3000, attachmentId: 'a1'}},
		],
	});
	assert.equal(message.plainTextAlternative(), null);
});
