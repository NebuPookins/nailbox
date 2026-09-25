import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import fileio from '../helpers/fileio.js';

test('saveJsonToFile leaves the most recently requested contents after concurrent writes', async () => {
	const tempDir = await mkdtemp(path.join(tmpdir(), 'railbox-fileio-'));
	const targetPath = path.join(tempDir, 'state.json');

	try {
		await Promise.all([
			fileio.saveJsonToFile({value: 1}, targetPath),
			fileio.saveJsonToFile({value: 2}, targetPath),
			fileio.saveJsonToFile({value: 3}, targetPath),
		]);

		const savedContent = JSON.parse(await readFile(targetPath, 'utf8'));
		assert.deepEqual(savedContent, {value: 3});
	} finally {
		await rm(tempDir, {recursive: true, force: true});
	}
});

test('saveJsonToFile persists the data as it was when save was requested', async () => {
	const tempDir = await mkdtemp(path.join(tmpdir(), 'railbox-fileio-'));
	const targetPath = path.join(tempDir, 'state.json');

	try {
		const data = {threadIds: ['a', 'b', 'c']};
		const firstSave = fileio.saveJsonToFile(data, targetPath);
		data.threadIds = ['a', 'b'];
		await firstSave;

		const savedContent = JSON.parse(await readFile(targetPath, 'utf8'));
		assert.deepEqual(savedContent, {threadIds: ['a', 'b', 'c']});
	} finally {
		await rm(tempDir, {recursive: true, force: true});
	}
});

test('saveJsonToFile rejects unserializable data without blocking later writes', async () => {
	const tempDir = await mkdtemp(path.join(tmpdir(), 'railbox-fileio-'));
	const targetPath = path.join(tempDir, 'state.json');

	try {
		const cyclic = {};
		cyclic.self = cyclic;
		await assert.rejects(fileio.saveJsonToFile(cyclic, targetPath), TypeError);
		await fileio.saveJsonToFile({value: 'after'}, targetPath);

		const savedContent = JSON.parse(await readFile(targetPath, 'utf8'));
		assert.deepEqual(savedContent, {value: 'after'});
	} finally {
		await rm(tempDir, {recursive: true, force: true});
	}
});
