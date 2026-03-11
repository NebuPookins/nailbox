import test from 'node:test';
import assert from 'node:assert/strict';

import {
	formatReadTime,
	getLabelName,
	getThreadMainDisplayedLabelIds,
	renderThreadGroup,
	renderThreadItem,
} from '../src/frontend/thread_list_presenter.js';

function createMoment() {
	return function moment(value) {
		return {
			isSame(_other, unit) {
				return value === 'today' ? unit === 'day' : false;
			},
			format(pattern) {
				return pattern === 'h:mm A' ? '9:15 AM' : pattern;
			},
		};
	};
}

test('formatReadTime handles seconds and minutes', () => {
	assert.equal(formatReadTime(0), '0 sec read');
	assert.equal(formatReadTime(45), '45 sec read');
	assert.equal(formatReadTime(90), '2 min read');
});

test('getThreadMainDisplayedLabelIds removes reserved Gmail labels', () => {
	assert.deepEqual(getThreadMainDisplayedLabelIds({
		labelIds: ['INBOX', 'Label_1', 'UNREAD', 'TRASH', 'Label_2'],
	}), ['Label_1', 'Label_2']);
});

test('getLabelName humanizes Gmail category labels', () => {
	assert.equal(getLabelName('CATEGORY_PERSONAL', [
		{id: 'CATEGORY_PERSONAL', name: 'CATEGORY_PERSONAL', type: 'system'},
	]), 'Personal');
});

test('renderThreadGroup wraps the group label', () => {
	assert.equal(renderThreadGroup({label: 'Important'}), '<div class="group">Important</div>');
});

test('renderThreadItem escapes content and includes controls', () => {
	const html = renderThreadItem({
		labelIds: ['INBOX', 'Label_1'],
		lastUpdated: 'today',
		messageIds: ['m1', 'm2'],
		receivers: [{name: 'Bob'}],
		recentMessageReadTimeSeconds: 30,
		senders: [{name: 'Alice', email: 'alice@example.com'}, {name: 'Carol'}],
		snippet: '<script>alert(1)</script>',
		subject: 'Subject & stuff',
		threadId: 'thread-1',
		totalTimeToReadSeconds: 120,
		visibility: 'updated',
	}, {
		labels: [{id: 'Label_1', name: 'Finance', type: 'user'}],
		momentLib: createMoment(),
	});

	assert.match(html, /class="thread visibility-updated"/);
	assert.match(html, /data-thread-id="thread-1"/);
	assert.match(html, /Subject &amp; stuff/);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.match(html, /Finance/);
	assert.match(html, /2 min read/);
	assert.match(html, /30 sec read/);
	assert.match(html, /href="https:\/\/mail\.google\.com\/mail\/u\/0\/#inbox\/thread-1"/);
});
