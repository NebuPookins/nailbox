import test from 'node:test';
import assert from 'node:assert/strict';

import { createConfigRepository } from '../src/server/repositories/config_repository.js';

test('config repository normalizes missing nested config on read', async () => {
	const repository = createConfigRepository({
		fileioImpl: {
			async readJsonFromOptionalFile() {
				return {};
			},
			async saveJsonToFile() {
				throw new Error('should not be called');
			},
		},
		pathToConfig: 'ignored.json',
	});

	const config = await repository.readConfig();

	assert.deepEqual(config.googleOAuth, {});
	assert.deepEqual(config.emailGroupingRules, {rules: []});
});

test('config repository validates and persists normalized config on save', async () => {
	let savedConfig = null;
	let savedPath = null;
	const repository = createConfigRepository({
		fileioImpl: {
			async readJsonFromOptionalFile() {
				throw new Error('should not be called');
			},
			async saveJsonToFile(json, filePath) {
				savedConfig = json;
				savedPath = filePath;
				return json;
			},
		},
		pathToConfig: 'data/config.json',
	});

	const result = await repository.saveConfig({
		port: 3000,
		googleOAuth: {
			clientId: 'abc',
		},
	});

	assert.equal(savedPath, 'data/config.json');
	assert.deepEqual(savedConfig, result);
	assert.equal(result.port, 3000);
	assert.equal(result.googleOAuth.clientId, 'abc');
	assert.deepEqual(result.emailGroupingRules, {rules: []});
});

test('config repository defaults to no sender render modes', async () => {
	const repository = createConfigRepository({
		fileioImpl: {
			async readJsonFromOptionalFile() {
				return {};
			},
			async saveJsonToFile() {},
		},
		pathToConfig: 'ignored.json',
	});

	assert.deepEqual((await repository.readConfig()).senderRenderModes, {});
});

test('config repository persists sender render modes, normalizing the email key', async () => {
	let savedConfig = null;
	const repository = createConfigRepository({
		fileioImpl: {
			async readJsonFromOptionalFile() {
				return savedConfig;
			},
			async saveJsonToFile(json) {
				savedConfig = json;
			},
		},
		pathToConfig: 'ignored.json',
	});

	await repository.saveConfig({senderRenderModes: {' Al@Example.com ': 'reader', 'bo@example.com': 'plain'}});
	const config = await repository.readConfig();

	assert.deepEqual(config.senderRenderModes, {'al@example.com': 'reader', 'bo@example.com': 'plain'});
});

test('config repository rejects an unknown render mode', async () => {
	const repository = createConfigRepository({
		fileioImpl: {
			async readJsonFromOptionalFile() {
				return {};
			},
			async saveJsonToFile() {},
		},
		pathToConfig: 'ignored.json',
	});

	await assert.rejects(
		repository.saveConfig({senderRenderModes: {'al@example.com': 'sparkly'}}),
		{code: 'INVALID_CONTRACT'},
	);
});
