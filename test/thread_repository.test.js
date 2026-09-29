import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createThreadRepository } from '../src/server/repositories/thread_repository.js';

test('listThreadIds returns only cached thread IDs, not in-flight temp files', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		await writeFile(path.join(threadsDirectory, '18c2f0a1b2c3d4e5'), '{}');
		await writeFile(path.join(threadsDirectory, '18c2f0a1b2c3d4e5.123.0b1e-4f2a.tmp'), '{}');

		const threadRepository = createThreadRepository({ threadsDirectory });

		assert.deepEqual(await threadRepository.listThreadIds(), ['18c2f0a1b2c3d4e5']);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});
