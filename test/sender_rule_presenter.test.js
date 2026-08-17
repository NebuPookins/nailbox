import test from 'node:test';
import assert from 'node:assert/strict';

import { addSenderEmailCondition, describeSenderConditions } from '../src/frontend/sender_rule_presenter.js';

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

test('addSenderEmailCondition appends a sender email condition to the chosen rule', () => {
	const result = addSenderEmailCondition(makeConfig(), 1, '@example.com');

	assert.deepEqual(result.rules[1].conditions, [
		{ type: 'sender_email', value: '@example.com' },
	]);
});

test('addSenderEmailCondition leaves the other rules untouched', () => {
	const result = addSenderEmailCondition(makeConfig(), 1, '@example.com');

	assert.deepEqual(result.rules[0], makeConfig().rules[0]);
	assert.equal(result.rules.length, 2);
});

test('addSenderEmailCondition keeps the existing conditions of the chosen rule', () => {
	const result = addSenderEmailCondition(makeConfig(), 0, 'jsmith@example.com');

	assert.deepEqual(result.rules[0].conditions, [
		{ type: 'subject', value: 'invoice' },
		{ type: 'sender_email', value: 'jsmith@example.com' },
	]);
});

test('addSenderEmailCondition does not mutate the config it was given', () => {
	const config = makeConfig();

	addSenderEmailCondition(config, 1, '@example.com');

	assert.deepEqual(config, makeConfig());
});

test('addSenderEmailCondition does not append a condition the rule already has', () => {
	const config = addSenderEmailCondition(makeConfig(), 1, '@example.com');

	const result = addSenderEmailCondition(config, 1, '@example.com');

	assert.deepEqual(result.rules[1].conditions, [
		{ type: 'sender_email', value: '@example.com' },
	]);
});

test('addSenderEmailCondition appends the same value to a different rule', () => {
	const config = addSenderEmailCondition(makeConfig(), 1, '@example.com');

	const result = addSenderEmailCondition(config, 0, '@example.com');

	assert.deepEqual(result.rules[0].conditions, [
		{ type: 'subject', value: 'invoice' },
		{ type: 'sender_email', value: '@example.com' },
	]);
	assert.deepEqual(result.rules[1].conditions, [
		{ type: 'sender_email', value: '@example.com' },
	]);
});

test('addSenderEmailCondition returns an equivalent config when the index is out of range', () => {
	const result = addSenderEmailCondition(makeConfig(), 7, '@example.com');

	assert.deepEqual(result, makeConfig());
});

test('describeSenderConditions lists only the sender email conditions', () => {
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

	assert.equal(describeSenderConditions(rule), '@example.com, boss@work.test');
});

test('describeSenderConditions returns an empty string when there are none', () => {
	assert.equal(describeSenderConditions({
		name: 'Work',
		priority: 10,
		sortType: 'mostRecent',
		conditions: [{ type: 'subject', value: 'invoice' }],
	}), '');
});
