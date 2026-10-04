import test from 'node:test';
import assert from 'node:assert/strict';

import {MIN_ARTICLE_TEXT_LENGTH, readerViewFor} from '../src/frontend/reader_view.js';

const longText = 'word '.repeat(MIN_ARTICLE_TEXT_LENGTH);

test('readerViewFor returns the article content when the parser extracts enough text', () => {
	const view = readerViewFor('<html>', () => ({content: '<div>article</div>', textContent: longText}));
	assert.deepEqual(view, {kind: 'article', html: '<div>article</div>'});
});

test('readerViewFor passes the message html to the parser', () => {
	let received = null;
	readerViewFor('<p>source</p>', (html) => {
		received = html;
		return null;
	});
	assert.equal(received, '<p>source</p>');
});

test('readerViewFor is unavailable when the parser finds no article', () => {
	assert.deepEqual(readerViewFor('<html>', () => null), {kind: 'unavailable'});
});

test('readerViewFor is unavailable when the article has no content', () => {
	assert.deepEqual(
		readerViewFor('<html>', () => ({content: null, textContent: longText})),
		{kind: 'unavailable'},
	);
});

test('readerViewFor is unavailable when the extracted text is very short', () => {
	assert.deepEqual(
		readerViewFor('<html>', () => ({content: '<p>hi</p>', textContent: 'hi'})),
		{kind: 'unavailable'},
	);
});
