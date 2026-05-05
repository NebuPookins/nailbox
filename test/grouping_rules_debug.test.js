import test from 'node:test';
import assert from 'node:assert/strict';

import { traceGrouping } from '../src/frontend/grouping_rules_debug.ts';

function makeThread(overrides = {}) {
	return {
		type: 'thread',
		threadId: overrides.threadId || 't1',
		senders: overrides.senders || [{ name: 'Alice', email: 'alice@example.com' }],
		receivers: [],
		lastUpdated: 1,
		subject: overrides.subject ?? 'Hello',
		snippet: 'snippet',
		messageIds: ['m1'],
		labelIds: [],
		visibility: overrides.visibility || 'updated',
		totalTimeToReadSeconds: 10,
		recentMessageReadTimeSeconds: 10,
	};
}

function makeBundle(overrides = {}) {
	return {
		type: 'bundle',
		bundleId: overrides.bundleId || 'b1',
		threadIds: ['t1', 't2'],
		senders: overrides.senders || [{ name: 'Alice', email: 'alice@example.com' }],
		lastUpdated: 1,
		visibility: overrides.visibility || 'updated',
		threadCount: 2,
		memberThreads: [],
		totalTimeToReadSeconds: 10,
		recentMessageReadTimeSeconds: 10,
	};
}

test('traceGrouping returns Others when no rules match', () => {
	const thread = makeThread({ senders: [{ name: 'Alice', email: 'alice@example.com' }] });
	const trace = traceGrouping(thread, {
		rules: [{
			name: 'Work',
			priority: 10,
			sortType: 'mostRecent',
			conditions: [{ type: 'sender_email', value: '@work.com' }],
		}],
	});
	assert.equal(trace.matchedRuleName, null);
	assert.equal(trace.finalGroupLabel, 'Others');
	assert.equal(trace.rules.length, 1);
	assert.equal(trace.rules[0].matched, false);
	assert.equal(trace.rules[0].skipped, false);
	assert.equal(trace.rules[0].conditions[0].matched, false);
});

test('traceGrouping marks the matching rule and skips later rules', () => {
	const thread = makeThread({ senders: [{ name: 'Alice', email: 'alice@example.com' }] });
	const trace = traceGrouping(thread, {
		rules: [
			{
				name: 'Personal',
				priority: 10,
				sortType: 'mostRecent',
				conditions: [{ type: 'sender_email', value: '@example.com' }],
			},
			{
				name: 'Other',
				priority: 20,
				sortType: 'mostRecent',
				conditions: [{ type: 'sender_email', value: 'noop' }],
			},
		],
	});
	assert.equal(trace.matchedRuleName, 'Personal');
	assert.equal(trace.finalGroupLabel, 'Personal');
	assert.equal(trace.rules[0].matched, true);
	assert.equal(trace.rules[0].skipped, false);
	assert.equal(trace.rules[1].matched, false);
	assert.equal(trace.rules[1].skipped, true);
	assert.match(trace.rules[1].skippedReason || '', /already matched/i);
});

test('traceGrouping reports per-sender details for sender conditions', () => {
	const thread = makeThread({ senders: [
		{ name: 'Alice', email: 'alice@example.com' },
		{ name: 'Bob', email: 'bob@elsewhere.com' },
	] });
	const trace = traceGrouping(thread, {
		rules: [{
			name: 'Personal',
			priority: 10,
			sortType: 'mostRecent',
			conditions: [{ type: 'sender_email', value: '@example.com' }],
		}],
	});
	const cond = trace.rules[0].conditions[0];
	assert.equal(cond.details.length, 2);
	assert.equal(cond.details[0].matched, true);
	assert.equal(cond.details[0].value, 'alice@example.com');
	assert.equal(cond.details[1].matched, false);
	assert.equal(cond.details[1].value, 'bob@elsewhere.com');
});

test('traceGrouping subject conditions never match for bundles', () => {
	const bundle = makeBundle({ senders: [{ name: 'Alice', email: 'alice@example.com' }] });
	const trace = traceGrouping(bundle, {
		rules: [{
			name: 'BySubject',
			priority: 10,
			sortType: 'mostRecent',
			conditions: [{ type: 'subject', value: 'anything' }],
		}],
	});
	assert.equal(trace.matchedRuleName, null);
	assert.equal(trace.rules[0].matched, false);
	assert.equal(trace.rules[0].conditions[0].matched, false);
	assert.match(trace.rules[0].conditions[0].reason, /bundle/i);
});

test('traceGrouping appends "When I Have Time" suffix when item visibility is when-i-have-time', () => {
	const thread = makeThread({
		senders: [{ name: 'Alice', email: 'alice@example.com' }],
		visibility: 'when-i-have-time',
	});
	const trace = traceGrouping(thread, {
		rules: [{
			name: 'Personal',
			priority: 10,
			sortType: 'mostRecent',
			conditions: [{ type: 'sender_email', value: '@example.com' }],
		}],
	});
	assert.equal(trace.matchedRuleName, 'Personal');
	assert.equal(trace.finalGroupLabel, 'Personal - When I Have Time');
});

test('traceGrouping with empty conditions does not match', () => {
	const thread = makeThread();
	const trace = traceGrouping(thread, {
		rules: [{
			name: 'Empty',
			priority: 10,
			sortType: 'mostRecent',
			conditions: [],
		}],
	});
	assert.equal(trace.matchedRuleName, null);
	assert.equal(trace.rules[0].matched, false);
	assert.equal(trace.rules[0].conditions.length, 0);
});

test('traceGrouping handles configs with no rules', () => {
	const thread = makeThread();
	const trace = traceGrouping(thread, { rules: [] });
	assert.equal(trace.matchedRuleName, null);
	assert.equal(trace.finalGroupLabel, 'Others');
	assert.equal(trace.rules.length, 0);
});
