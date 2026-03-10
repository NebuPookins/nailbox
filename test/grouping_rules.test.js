import test from 'node:test';
import assert from 'node:assert/strict';

import { getEmailGroupingRules, groupThreads, threadMatchesRule } from '../src/server/domain/grouping_rules.js';

test('getEmailGroupingRules returns empty rules when config is missing them', () => {
	assert.deepEqual(getEmailGroupingRules({}), {rules: []});
});

test('threadMatchesRule matches sender email and subject conditions', () => {
	const thread = {
		senders: [{name: 'Alice', email: 'alice@example.com'}],
		subject: 'Quarterly report',
	};
	assert.equal(threadMatchesRule(thread, {
		conditions: [{type: 'sender_email', value: '@example.com'}],
	}), true);
	assert.equal(threadMatchesRule(thread, {
		conditions: [{type: 'subject', value: 'report'}],
	}), true);
});

test('groupThreads groups matching threads and preserves shortest-first sorting', () => {
	const groups = groupThreads({
		threads: [
			{
				threadId: '1',
				senders: [{name: 'Alice', email: 'alice@example.com'}],
				subject: 'Alpha',
				visibility: 'updated',
				totalTimeToReadSeconds: 40,
				lastUpdated: 2,
			},
			{
				threadId: '2',
				senders: [{name: 'Bob', email: 'bob@example.com'}],
				subject: 'Beta',
				visibility: 'updated',
				totalTimeToReadSeconds: 10,
				lastUpdated: 1,
			},
		],
		groupingRules: {
			rules: [{
				name: 'Important',
				priority: 10,
				sortType: 'shortest',
				conditions: [{type: 'sender_email', value: '@example.com'}],
			}],
		},
		hideUntilComparator: (a, b) => b.lastUpdated - a.lastUpdated,
	});

	assert.equal(groups.length, 1);
	assert.equal(groups[0].label, 'Important');
	assert.deepEqual(groups[0].threads.map((thread) => thread.threadId), ['2', '1']);
});
