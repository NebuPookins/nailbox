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

	assert.deepEqual(config, {
		googleOAuth: {},
		emailGroupingRules: {rules: []},
	});
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
	assert.deepEqual(result, {
		port: 3000,
		googleOAuth: {
			clientId: 'abc',
		},
		emailGroupingRules: {rules: []},
	});
});
