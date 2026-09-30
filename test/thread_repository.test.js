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

test('readHistoryId reads the cached historyId and tracks later saves and deletes', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		const thread = (historyId) => ({ id: threadId, historyId, messages: [] });
		await writeFile(path.join(threadsDirectory, threadId), JSON.stringify(thread('100')));
		const threadRepository = createThreadRepository({ threadsDirectory });

		assert.equal(await threadRepository.readHistoryId(threadId), '100');

		await threadRepository.saveThreadJson(threadId, thread('200'));
		assert.equal(await threadRepository.readHistoryId(threadId), '200');

		await threadRepository.deleteThread(threadId);
		assert.equal(await threadRepository.readHistoryId(threadId), undefined);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('readHistoryId falls back to parsing the file when historyId is not at its start', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		await writeFile(path.join(threadsDirectory, threadId), JSON.stringify({ messages: [], id: threadId, historyId: '300' }));
		const threadRepository = createThreadRepository({ threadsDirectory });

		assert.equal(await threadRepository.readHistoryId(threadId), '300');
		assert.equal(await threadRepository.readHistoryId('0000000000000000'), undefined);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('readHistoryId does not let a slow disk read overwrite a newer save', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		// historyId not at the start of the file, so the read takes the full
		// parse path, which the fake fileio below holds open.
		await writeFile(path.join(threadsDirectory, threadId), JSON.stringify({ messages: [], id: threadId, historyId: '100' }));
		let finishRead;
		const threadRepository = createThreadRepository({
			threadsDirectory,
			fileioImpl: {
				readJsonFromOptionalFile: () => new Promise((resolve) => {
					finishRead = () => resolve({ id: threadId, historyId: '100', messages: [] });
				}),
				saveJsonToFile: async () => {},
			},
		});

		const staleRead = threadRepository.readHistoryId(threadId);
		while (!finishRead) {
			await new Promise((resolve) => setImmediate(resolve));
		}
		await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '200', messages: [] });
		finishRead();
		await staleRead;

		assert.equal(await threadRepository.readHistoryId(threadId), '200');
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});
