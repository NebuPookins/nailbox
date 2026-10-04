import test from 'node:test';
import assert from 'node:assert/strict';

import {renderModeFor, senderKeyOf} from '../src/frontend/render_mode.js';
import {linkifySegments} from '../src/frontend/linkify.js';

test('renderModeFor uses the sender saved mode, matching the address case-insensitively', () => {
	assert.equal(renderModeFor({'al@example.com': 'reader'}, [{name: 'Al', email: 'Al@Example.com'}]), 'reader');
});

test('renderModeFor defaults to original for unknown senders and missing senders', () => {
	assert.equal(renderModeFor({'al@example.com': 'plain'}, [{name: 'Bo', email: 'bo@example.com'}]), 'original');
	assert.equal(renderModeFor({'al@example.com': 'plain'}, [null]), 'original');
	assert.equal(renderModeFor({}, []), 'original');
});

test('senderKeyOf is undefined when no sender has an email', () => {
	assert.equal(senderKeyOf([{name: 'No Email'}]), undefined);
});

test('linkifySegments separates URLs from surrounding text and drops trailing punctuation', () => {
	assert.deepEqual(linkifySegments('See https://example.com/a?b=1, then http://x.org.'), [
		{kind: 'text', text: 'See '},
		{kind: 'link', url: 'https://example.com/a?b=1'},
		{kind: 'text', text: ', then '},
		{kind: 'link', url: 'http://x.org'},
		{kind: 'text', text: '.'},
	]);
});

test('linkifySegments leaves text without URLs alone and never links other schemes', () => {
	assert.deepEqual(linkifySegments('no links javascript:alert(1)'), [{kind: 'text', text: 'no links javascript:alert(1)'}]);
	assert.deepEqual(linkifySegments(''), []);
});
