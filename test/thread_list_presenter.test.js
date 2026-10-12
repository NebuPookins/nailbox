import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
