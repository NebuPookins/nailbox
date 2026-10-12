import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeMimeWords } from '../helpers/mime_words.js';

test('decodeMimeWords decodes base64 and quoted-printable encoded words', () => {
	assert.equal(decodeMimeWords('=?UTF-8?B?w6lsw6luZQ==?= <e@example.com>'), 'éléne <e@example.com>');
	assert.equal(decodeMimeWords('=?iso-8859-1?Q?Andr=E9_Pirard?='), 'André Pirard');
});

test('decodeMimeWords joins adjacent encoded words without the whitespace between them', () => {
	assert.equal(decodeMimeWords('=?UTF-8?Q?Hello?= =?UTF-8?Q?_World?='), 'Hello World');
});

test('decodeMimeWords leaves plain text and words in unknown charsets unchanged', () => {
	assert.equal(decodeMimeWords('Alfred Alpha'), 'Alfred Alpha');
	assert.equal(decodeMimeWords('=?x-not-a-charset?Q?abc?='), '=?x-not-a-charset?Q?abc?=');
});

test('decodeMimeWords decodes a multi-byte character split across adjacent encoded words', () => {
	assert.equal(decodeMimeWords('=?UTF-8?B?8J+Y?= =?UTF-8?B?gA==?= <e@example.com>'), '\u{1F600} <e@example.com>');
});
