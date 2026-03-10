import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import fileio from '../helpers/fileio.js';

test('saveJsonToFile handles concurrent writes without temp-file collisions', async () => {
	const tempDir = await mkdtemp(path.join(tmpdir(), 'railbox-fileio-'));
	const targetPath = path.join(tempDir, 'state.json');

	try {
		await Promise.all([
			fileio.saveJsonToFile({value: 1}, targetPath),
			fileio.saveJsonToFile({value: 2}, targetPath),
			fileio.saveJsonToFile({value: 3}, targetPath),
		]);

		const savedContent = JSON.parse(await readFile(targetPath, 'utf8'));
		assert.equal(typeof savedContent.value, 'number');
		assert.ok([1, 2, 3].includes(savedContent.value));
	} finally {
		await rm(tempDir, {recursive: true, force: true});
	}
});
