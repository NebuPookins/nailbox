import test from 'node:test';
import assert from 'node:assert/strict';

import { addCondition, describeConditions, resolvePattern } from '../src/frontend/sender_rule_presenter.js';

function makeConfig() {
	return {
		rules: [
			{
				name: 'Work',
				priority: 10,
				sortType: 'mostRecent',
				conditions: [{ type: 'subject', value: 'invoice' }],
			},
			{
				name: 'Newsletters',
				priority: 20,
				sortType: 'shortest',
				conditions: [],
			},
		],
	};
}

test('addCondition appends a condition to the chosen rule', () => {
	const result = addCondition(makeConfig(), 1, 'sender_email', '@example.com');

	assert.deepEqual(result.rules[1].conditions, [
		{ type: 'sender_email', value: '@example.com' },
	]);
});

test('addCondition leaves the other rules untouched', () => {
	const result = addCondition(makeConfig(), 1, 'sender_email', '@example.com');

	assert.deepEqual(result.rules[0], makeConfig().rules[0]);
	assert.equal(result.rules.length, 2);
});

test('addCondition keeps the existing conditions of the chosen rule', () => {
	const result = addCondition(makeConfig(), 0, 'sender_email', 'jsmith@example.com');

	assert.deepEqual(result.rules[0].conditions, [
		{ type: 'subject', value: 'invoice' },
		{ type: 'sender_email', value: 'jsmith@example.com' },
	]);
});

test('addCondition does not mutate the config it was given', () => {
	const config = makeConfig();

	addCondition(config, 1, 'sender_email', '@example.com');

	assert.deepEqual(config, makeConfig());
});

test('addCondition does not append a condition the rule already has', () => {
	const config = addCondition(makeConfig(), 1, 'sender_email', '@example.com');

	const result = addCondition(config, 1, 'sender_email', '@example.com');

	assert.deepEqual(result.rules[1].conditions, [
		{ type: 'sender_email', value: '@example.com' },
	]);
});

test('addCondition appends the same value to a different rule', () => {
	const config = addCondition(makeConfig(), 1, 'sender_email', '@example.com');

	const result = addCondition(config, 0, 'sender_email', '@example.com');

	assert.deepEqual(result.rules[0].conditions, [
		{ type: 'subject', value: 'invoice' },
		{ type: 'sender_email', value: '@example.com' },
	]);
	assert.deepEqual(result.rules[1].conditions, [
		{ type: 'sender_email', value: '@example.com' },
	]);
});

test('addCondition returns an equivalent config when the index is out of range', () => {
	const result = addCondition(makeConfig(), 7, 'sender_email', '@example.com');

	assert.deepEqual(result, makeConfig());
});

test('addCondition supports sender_name conditions', () => {
	const result = addCondition(makeConfig(), 0, 'sender_name', 'Jane');

	assert.deepEqual(result.rules[0].conditions, [
		{ type: 'subject', value: 'invoice' },
		{ type: 'sender_name', value: 'Jane' },
	]);
});

test('addCondition supports subject conditions', () => {
	const result = addCondition(makeConfig(), 1, 'subject', 'receipt');

	assert.deepEqual(result.rules[1].conditions, [
		{ type: 'subject', value: 'receipt' },
	]);
});

test('describeConditions lists only the conditions matching the given type', () => {
	const rule = {
		name: 'Work',
		priority: 10,
		sortType: 'mostRecent',
		conditions: [
			{ type: 'subject', value: 'invoice' },
			{ type: 'sender_email', value: '@example.com' },
			{ type: 'sender_name', value: 'Jane' },
			{ type: 'sender_email', value: 'boss@work.test' },
		],
	};

	assert.equal(describeConditions(rule, 'sender_email'), '@example.com, boss@work.test');
	assert.equal(describeConditions(rule, 'sender_name'), 'Jane');
	assert.equal(describeConditions(rule, 'subject'), 'invoice');
});

test('describeConditions returns an empty string when there are none of that type', () => {
	assert.equal(describeConditions({
		name: 'Work',
		priority: 10,
		sortType: 'mostRecent',
		conditions: [{ type: 'subject', value: 'invoice' }],
	}, 'sender_name'), '');
});

test('resolvePattern defaults sender_email to the sender\'s email', () => {
	assert.equal(resolvePattern({}, 'sender_email', 'alice@example.com'), 'alice@example.com');
});

test('resolvePattern defaults sender_name and subject to an empty string', () => {
	assert.equal(resolvePattern({}, 'sender_name', 'alice@example.com'), '');
	assert.equal(resolvePattern({}, 'subject', 'alice@example.com'), '');
});

test('resolvePattern returns the value stored for that condition type', () => {
	const patternsByType = { subject: 'invoice', sender_name: 'Jane' };

	assert.equal(resolvePattern(patternsByType, 'subject', 'alice@example.com'), 'invoice');
	assert.equal(resolvePattern(patternsByType, 'sender_name', 'alice@example.com'), 'Jane');
});

test('resolvePattern does not leak a value stored for a different condition type', () => {
	const patternsByType = { subject: 'invoice' };

	assert.equal(resolvePattern(patternsByType, 'sender_email', 'alice@example.com'), 'alice@example.com');
	assert.equal(resolvePattern(patternsByType, 'sender_name', 'alice@example.com'), '');
});

test('resolvePattern respects a deliberately cleared value instead of falling back to the default', () => {
	const patternsByType = { sender_email: '' };

	assert.equal(resolvePattern(patternsByType, 'sender_email', 'alice@example.com'), '');
});
