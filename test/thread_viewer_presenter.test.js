import test from 'node:test';
import assert from 'node:assert/strict';

import {
	renderDeletedMessagesNotice,
	renderThreadMessage,
} from '../src/frontend/thread_viewer_presenter.js';

function createMoment() {
	return function moment(value) {
		return {
			isSame(_other, unit) {
				return value === 'today' ? unit === 'day' : false;
			},
			format(pattern) {
				return pattern === 'h:mm A' ? '8:00 AM' : pattern;
			},
		};
	};
}

test('renderDeletedMessagesNotice includes the Gmail trash link', () => {
	const html = renderDeletedMessagesNotice({
		num: 2,
		threadId: 'thread-1',
	});

	assert.match(html, /2 deleted messages/);
	assert.match(html, /https:\/\/mail\.google\.com\/mail\/u\/0\/#trash\/thread-1/);
});

test('renderThreadMessage escapes text fields and preserves sanitized html body', () => {
	const html = renderThreadMessage({
		attachments: [{attachmentId: 'att-1', filename: 'report.txt', size: 42}],
		body: {sanitized: '<p>Hello</p>'},
		date: 'today',
		duration: '2 minutes',
		from: [{name: 'Alice <Admin>'}],
		messageId: 'msg-1',
		to: [{name: 'Bob'}],
		wordcount: 10,
	}, {
		filesizeLib(size) {
			return size + ' bytes';
		},
		momentLib: createMoment(),
	});

	assert.match(html, /data-message-id="msg-1"/);
	assert.match(html, /Alice &lt;Admin&gt;/);
	assert.match(html, /<p>Hello<\/p>/);
	assert.match(html, /report\.txt42 bytes/);
	assert.match(html, /8:00 AM/);
	assert.doesNotMatch(html, /&lt;p&gt;Hello&lt;\/p&gt;/);
});
