import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import fileio from '../helpers/fileio.js';
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
				// Holds only the first read; the save's own read of the cached copy goes straight through.
				readJsonFromOptionalFile: () => finishRead
					? Promise.resolve({ id: threadId, historyId: '100', messages: [] })
					: new Promise((resolve) => {
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

test('saveThreadJson leaves the cache untouched when the thread is unchanged', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		const thread = { id: threadId, historyId: '100', messages: [] };
		await writeFile(path.join(threadsDirectory, threadId), JSON.stringify(thread));
		const threadRepository = createThreadRepository({
			threadsDirectory,
			fileioImpl: {
				...fileio,
				saveJsonToFile: async () => {
					throw new Error('saveJsonToFile should not be called for an unchanged thread');
				},
			},
		});

		assert.equal(await threadRepository.saveThreadJson(threadId, { ...thread }), false);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('saveThreadJson overwrites a leftover cache file that has neither an id nor messages', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		await writeFile(path.join(threadsDirectory, threadId), '{}');
		const threadRepository = createThreadRepository({ threadsDirectory });
		const freshThread = { id: threadId, historyId: '100', messages: [] };

		assert.equal(await threadRepository.saveThreadJson(threadId, freshThread), true);
		assert.deepEqual(await threadRepository.readThreadJson(threadId), freshThread);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('saveThreadJson replaces a cached copy that fails validation', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		await writeFile(path.join(threadsDirectory, threadId), JSON.stringify({ id: threadId, historyId: '100', messages: [{ id: 'm1' }] }));
		const threadRepository = createThreadRepository({ threadsDirectory });
		const freshThread = { id: threadId, historyId: '100', messages: [] };

		assert.equal(await threadRepository.saveThreadJson(threadId, freshThread), true);
		assert.deepEqual(await threadRepository.readThreadJson(threadId), freshThread);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('saveThreadJson skips reading the cached copy when the historyId differs', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		await writeFile(path.join(threadsDirectory, threadId), JSON.stringify({ id: threadId, historyId: '100', messages: [] }));
		const threadRepository = createThreadRepository({
			threadsDirectory,
			fileioImpl: {
				...fileio,
				readJsonFromOptionalFile: async () => {
					throw new Error('readJsonFromOptionalFile should not be called when the historyId differs');
				},
			},
		});

		assert.equal(await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '200', messages: [] }), true);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('concurrent saves of one thread are written one at a time', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		let writesInFlight = 0;
		let maxWritesInFlight = 0;
		const threadRepository = createThreadRepository({
			threadsDirectory,
			fileioImpl: {
				...fileio,
				saveJsonToFile: async (json, filePath) => {
					writesInFlight += 1;
					maxWritesInFlight = Math.max(maxWritesInFlight, writesInFlight);
					await new Promise((resolve) => setImmediate(resolve));
					await fileio.saveJsonToFile(json, filePath);
					writesInFlight -= 1;
				},
			},
		});

		await Promise.all(['100', '200', '300'].map((historyId) =>
			threadRepository.saveThreadJson(threadId, { id: threadId, historyId, messages: [] })));

		assert.equal(maxWritesInFlight, 1);
		assert.equal((await threadRepository.readThreadJson(threadId)).historyId, '300');
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});
