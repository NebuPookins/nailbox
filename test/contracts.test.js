import test from 'node:test';
import assert from 'node:assert/strict';

import {
	makeValidationError,
	normalizeAppConfig,
	normalizeGroupingRulesConfig,
	normalizeHideUntilDto,
	normalizeThreadMessageDto,
	normalizeThreadSummaryDto,
	normalizeWordcountUpdateDto,
	validateThreadPayload,
} from '../src/server/validation/contracts.js';

test('normalizeAppConfig fills missing structured defaults', () => {
	assert.deepEqual(normalizeAppConfig({}), {
		googleOAuth: {},
		emailGroupingRules: {rules: []},
	});
});

test('normalizeGroupingRulesConfig normalizes omitted rules', () => {
	assert.deepEqual(normalizeGroupingRulesConfig({}), {rules: []});
});

test('validateThreadPayload rejects malformed message payloads', () => {
	assert.throws(() => {
		validateThreadPayload({
			id: 'abc123',
			messages: [{
				id: 'm1',
				labelIds: [],
				internalDate: 1,
				payload: {},
			}],
		});
	}, (error) => error.code === 'INVALID_CONTRACT');
});

test('normalizeHideUntilDto coerces timestamps and rejects invalid values', () => {
	assert.deepEqual(normalizeHideUntilDto({type: 'timestamp', value: '42'}), {
		type: 'timestamp',
		value: 42,
	});
	assert.throws(() => {
		normalizeHideUntilDto({type: 'timestamp', value: 'nope'});
	}, (error) => error.code === 'INVALID_CONTRACT');
});

test('normalizeWordcountUpdateDto coerces numeric strings', () => {
	assert.deepEqual(normalizeWordcountUpdateDto({wordcount: '123'}), {wordcount: 123});
});

test('normalizeThreadSummaryDto validates response shape', () => {
	const summary = normalizeThreadSummaryDto({
		threadId: 't1',
		senders: [{name: 'Alice', email: 'alice@example.com'}],
		receivers: [{name: 'Bob', email: 'bob@example.com'}],
		lastUpdated: 1,
		subject: 'Hi',
		snippet: null,
		messageIds: ['m1'],
		labelIds: ['INBOX'],
		visibility: 'updated',
		isWhenIHaveTime: false,
		needsRefreshing: true,
		totalTimeToReadSeconds: 30,
		recentMessageReadTimeSeconds: 15,
	});

	assert.equal(summary.threadId, 't1');
	assert.equal(summary.receivers[0].email, 'bob@example.com');
});

test('normalizeThreadMessageDto validates attachment shape', () => {
	const message = normalizeThreadMessageDto({
		deleted: false,
		messageId: 'm1',
		from: [{name: 'Alice', email: 'alice@example.com'}],
		to: [{name: 'Bob', email: 'bob@example.com'}],
		date: 1,
		body: {
			original: '<p>Hello</p>',
			sanitized: '<p>Hello</p>',
			plainText: 'Hello',
		},
		wordcount: 1,
		timeToReadSeconds: 1,
		attachments: [{filename: 'hello.txt', size: 5, attachmentId: 'att-1'}],
	});

	assert.equal(message.attachments[0].attachmentId, 'att-1');
});

test('makeValidationError marks the error code', () => {
	const error = makeValidationError('bad');
	assert.equal(error.code, 'INVALID_CONTRACT');
	assert.equal(error.message, 'bad');
});
