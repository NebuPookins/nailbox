import test from 'node:test';
import assert from 'node:assert/strict';

import {
	makeValidationError,
	normalizeAppConfig,
	normalizeGroupingRulesConfig,
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

test('makeValidationError marks the error code', () => {
	const error = makeValidationError('bad');
	assert.equal(error.code, 'INVALID_CONTRACT');
	assert.equal(error.message, 'bad');
});
