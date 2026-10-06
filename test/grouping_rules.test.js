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

test('groupThreads matches a bundle when any of its member threads match a rule', () => {
	const threadA = {
		threadId: 'a',
		senders: [{name: 'Alice', email: 'alice@elsewhere.com'}],
		subject: 'Lunch plans',
		visibility: 'updated',
		totalTimeToReadSeconds: 10,
		lastUpdated: 1,
	};
	const threadB = {
		threadId: 'b',
		senders: [{name: 'Bob', email: 'bob@work.com'}],
		subject: 'Status update',
		visibility: 'updated',
		totalTimeToReadSeconds: 20,
		lastUpdated: 2,
	};
	const groups = groupThreads(
		[threadA, threadB],
		[{bundleId: 'bundle-1', threadIds: ['a', 'b']}],
		{
			rules: [{
				name: 'Work',
				priority: 10,
				sortType: 'mostRecent',
				conditions: [{type: 'sender_email', value: '@work.com'}],
			}],
		},
		(a, b) => b.lastUpdated - a.lastUpdated,
	);

	assert.equal(groups.length, 1);
	assert.equal(groups[0].label, 'Work');
	assert.equal(groups[0].items.length, 1);
	assert.equal(groups[0].items[0].type, 'bundle');
	assert.equal(groups[0].items[0].bundleId, 'bundle-1');
});

test('groupThreads matches a bundle by subject when any member thread subject matches', () => {
	const threadA = {
		threadId: 'a',
		senders: [{name: 'Alice', email: 'alice@elsewhere.com'}],
		subject: 'Quarterly report',
		visibility: 'updated',
		totalTimeToReadSeconds: 10,
		lastUpdated: 1,
	};
	const threadB = {
		threadId: 'b',
		senders: [{name: 'Bob', email: 'bob@elsewhere.com'}],
		subject: 'Lunch plans',
		visibility: 'updated',
		totalTimeToReadSeconds: 20,
		lastUpdated: 2,
	};
	const groups = groupThreads(
		[threadA, threadB],
		[{bundleId: 'bundle-1', threadIds: ['a', 'b']}],
		{
			rules: [{
				name: 'Reports',
				priority: 10,
				sortType: 'mostRecent',
				conditions: [{type: 'subject', value: 'report'}],
			}],
		},
		(a, b) => b.lastUpdated - a.lastUpdated,
	);

	assert.equal(groups.length, 1);
	assert.equal(groups[0].label, 'Reports');
	assert.equal(groups[0].items[0].type, 'bundle');
});

test('groupThreads does not match a bundle when no member thread matches the rule', () => {
	const threadA = {
		threadId: 'a',
		senders: [{name: 'Alice', email: 'alice@elsewhere.com'}],
		subject: 'Lunch plans',
		visibility: 'updated',
		totalTimeToReadSeconds: 10,
		lastUpdated: 1,
	};
	const threadB = {
		threadId: 'b',
		senders: [{name: 'Bob', email: 'bob@elsewhere.com'}],
		subject: 'Quick chat',
		visibility: 'updated',
		totalTimeToReadSeconds: 20,
		lastUpdated: 2,
	};
	const groups = groupThreads(
		[threadA, threadB],
		[{bundleId: 'bundle-1', threadIds: ['a', 'b']}],
		{
			rules: [{
				name: 'Work',
				priority: 10,
				sortType: 'mostRecent',
				conditions: [{type: 'sender_email', value: '@work.com'}],
			}],
		},
		(a, b) => b.lastUpdated - a.lastUpdated,
	);

	assert.equal(groups.length, 1);
	assert.equal(groups[0].label, 'Others');
	assert.equal(groups[0].items[0].type, 'bundle');
});

test('groupThreads groups matching threads and preserves shortest-first sorting', () => {
	const groups = groupThreads(
		[
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
		[],
		{
			rules: [{
				name: 'Important',
				priority: 10,
				sortType: 'shortest',
				conditions: [{type: 'sender_email', value: '@example.com'}],
			}],
		},
		(a, b) => b.lastUpdated - a.lastUpdated,
	);

	assert.equal(groups.length, 1);
	assert.equal(groups[0].label, 'Important');
	assert.deepEqual(groups[0].items.filter((item) => item.type !== 'bundle').map((item) => item.threadId), ['2', '1']);
});

function thread(overrides) {
	return {
		type: 'thread',
		senders: [],
		subject: 'quick',
		visibility: 'updated',
		totalTimeToReadSeconds: 0,
		lastUpdated: 0,
		...overrides,
	};
}

function itemIdsOf(group) {
	return group.items.map((item) => item.type === 'bundle' ? item.bundleId : item.threadId);
}

test('groupThreads sorts bundles by their total read time in shortest-first groups', () => {
	const quickRule = {rules: [{name: 'Quick', priority: 10, sortType: 'shortest', conditions: [{type: 'subject', value: 'quick'}]}]};
	const groups = groupThreads(
		[
			thread({threadId: 'short', totalTimeToReadSeconds: 30}),
			thread({threadId: 'a', totalTimeToReadSeconds: 60}),
			thread({threadId: 'b', totalTimeToReadSeconds: 60}),
		],
		[{bundleId: 'long-bundle', threadIds: ['a', 'b']}],
		quickRule,
		() => 0,
	);

	assert.deepEqual(itemIdsOf(groups[0]), ['short', 'long-bundle']);
});

test('groupThreads ranks a bundle by the hide-untils of its member threads', () => {
	// Hide-untils are keyed by thread; 'hidden-a' and 'hidden-b' were hidden and
	// their snooze expired, so they rank below threads that were never hidden.
	const hiddenThreadIds = new Set(['hidden-a', 'hidden-b']);
	const comparator = (a, b) => {
		const rank = (key) => hiddenThreadIds.has(key.threadId) ? 1 : 0;
		return rank(a) - rank(b) || b.lastUpdated - a.lastUpdated;
	};
	const groups = groupThreads(
		[
			thread({threadId: 'hidden-a', visibility: 'visible', lastUpdated: 30}),
			thread({threadId: 'hidden-b', visibility: 'visible', lastUpdated: 20}),
			thread({threadId: 'fresh', lastUpdated: 10}),
		],
		[{bundleId: 'snoozed-bundle', threadIds: ['hidden-a', 'hidden-b']}],
		{rules: []},
		comparator,
	);

	assert.deepEqual(itemIdsOf(groups[0]), ['fresh', 'snoozed-bundle']);
});
