import test from 'node:test';
import assert from 'node:assert/strict';

import {
	formatGroupReadTimeStats,
	formatReadTime,
	getLabelName,
	getThreadMainDisplayedLabelIds,
} from '../src/frontend/thread_list_presenter.js';

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

test('formatGroupReadTimeStats counts items and sums their read times', () => {
	assert.equal(formatGroupReadTimeStats([
		{threadId: 'a', totalTimeToReadSeconds: 120, recentMessageReadTimeSeconds: 30},
		{type: 'bundle', bundleId: 'b', totalTimeToReadSeconds: 200, recentMessageReadTimeSeconds: 50},
	]), '2 items · Total: 5 min read · Recent: 1 min read');
});

test('formatGroupReadTimeStats handles empty and single-item groups', () => {
	assert.equal(formatGroupReadTimeStats([]), '0 items · Total: 0 sec read · Recent: 0 sec read');
	assert.equal(
		formatGroupReadTimeStats([{threadId: 'a', totalTimeToReadSeconds: 45, recentMessageReadTimeSeconds: 45}]),
		'1 item · Total: 45 sec read · Recent: 45 sec read',
	);
});
