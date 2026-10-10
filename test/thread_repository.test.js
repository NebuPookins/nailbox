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

test('saveThreadJson refuses a payload older than the cached copy', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		const threadRepository = createThreadRepository({ threadsDirectory });

		assert.equal(await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '200', messages: [] }), true);
		// Compared as numbers, not strings, which would put '1000' before '200'.
		assert.equal(await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '1000', messages: [] }), true);
		assert.equal(await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '200', messages: [] }), false);

		assert.equal((await threadRepository.readThreadJson(threadId)).historyId, '1000');
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('saveThreadJson refuses a payload fetched before the thread was deleted', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		const threadRepository = createThreadRepository({ threadsDirectory });
		await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '100', messages: [] });

		const deletionCountBeforeDelete = threadRepository.readDeletionCount(threadId);
		await threadRepository.deleteThread(threadId);
		const fetchedBeforeDelete = { id: threadId, historyId: '200', messages: [] };
		assert.equal(await threadRepository.saveThreadJson(threadId, fetchedBeforeDelete, { deletionCountAtFetch: deletionCountBeforeDelete }), false);
		assert.deepEqual(await threadRepository.readThreadJson(threadId), {});

		const fetchedAfterDelete = { id: threadId, historyId: '300', messages: [] };
		assert.equal(await threadRepository.saveThreadJson(threadId, fetchedAfterDelete, { deletionCountAtFetch: threadRepository.readDeletionCount(threadId) }), true);
		assert.deepEqual(await threadRepository.readThreadJson(threadId), fetchedAfterDelete);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('a save already queued behind a delete is refused if its payload was fetched before the delete', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		const threadRepository = createThreadRepository({ threadsDirectory });
		const deletionCountAtFetch = threadRepository.readDeletionCount(threadId);

		const [deleted, saved] = await Promise.all([
			threadRepository.deleteThread(threadId),
			threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '100', messages: [] }, { deletionCountAtFetch }),
		]);

		assert.equal(deleted, true);
		assert.equal(saved, false);
		assert.deepEqual(await threadRepository.readThreadJson(threadId), {});
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('evictThread keeps a cached copy newer than the evicting payload', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		const threadRepository = createThreadRepository({ threadsDirectory });
		await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '200', messages: [] });

		assert.equal(await threadRepository.evictThread(threadId, '100'), 'kept');
		assert.equal((await threadRepository.readThreadJson(threadId)).historyId, '200');

		assert.equal(await threadRepository.evictThread(threadId, '300'), 'deleted');
		assert.deepEqual(await threadRepository.readThreadJson(threadId), {});
		assert.equal(await threadRepository.evictThread(threadId, '300'), 'absent');
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

test('after evictThread, saveThreadJson refuses payloads older than the evicting one', async () => {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadId = '18c2f0a1b2c3d4e5';
		const threadRepository = createThreadRepository({ threadsDirectory });
		await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '100', messages: [] });

		assert.equal(await threadRepository.evictThread(threadId, '300'), 'deleted');
		assert.equal(await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '200', messages: [] }), false);
		assert.deepEqual(await threadRepository.readThreadJson(threadId), {});

		// Back in the inbox, e.g. after a reply.
		assert.equal(await threadRepository.saveThreadJson(threadId, { id: threadId, historyId: '400', messages: [] }), true);
		assert.equal((await threadRepository.readThreadJson(threadId)).historyId, '400');
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
});

// A minimal stand-in for the Thread model, summarising a persisted thread
// whose `subject` is set by the test.
class FakeThread {
	constructor(data) {
		this.data = data;
	}
	id() { return this.data.id; }
	snippet() { return null; }
	messages() { return []; }
	senders() { return []; }
	recipients() { return []; }
	lastUpdated() { return 5; }
	subject() { return this.data.subject; }
	messageIds() { return []; }
	labelIds() { return ['INBOX']; }
}

const summaryThreadId = '18c2f0a1b2c3d4e5';
const summaryThread = (subject, id = summaryThreadId) => ({ id, historyId: '1', messages: [], subject });
const subjectsOf = async (repository) => (await repository.listThreadSummaries()).map((s) => s.subject).sort();

async function withSummaryRepository(run, fileioImpl) {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadRepository = createThreadRepository({ threadsDirectory, threadModelModule: { Thread: FakeThread }, ...(fileioImpl && { fileioImpl }) });
		await run({ threadsDirectory, threadRepository });
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
}

// The parts of fileio the summary tests don't exercise.
const noopFileio = {
	readJsonFromOptionalFile: async () => ({}),
	saveJsonToFile: async () => {},
};

// A fileio whose reads return an old copy of the summary thread, each held
// until the test releases it, so the test can act while the scan is reading.
function heldReadFileio() {
	const readStarted = Promise.withResolvers();
	const readReleased = Promise.withResolvers();
	const fileioImpl = {
		...noopFileio,
		readJsonFromFile: async () => {
			readStarted.resolve();
			await readReleased.promise;
			return summaryThread('Old');
		},
	};
	return { fileioImpl, readStarted, readReleased };
}

test('listThreadSummaries lists the threads already on disk and skips unreadable ones', async () => {
	await withSummaryRepository(async ({ threadsDirectory, threadRepository }) => {
		await writeFile(path.join(threadsDirectory, summaryThreadId), JSON.stringify(summaryThread('On disk')));
		await writeFile(path.join(threadsDirectory, '28c2f0a1b2c3d4e5'), 'not json');
		assert.deepEqual(await subjectsOf(threadRepository), ['On disk']);
	});
});

test('listThreadSummaries reflects a save, including a change to a single field', async () => {
	await withSummaryRepository(async ({ threadsDirectory, threadRepository }) => {
		await writeFile(path.join(threadsDirectory, summaryThreadId), JSON.stringify(summaryThread('Old')));
		assert.deepEqual(await subjectsOf(threadRepository), ['Old']);

		await threadRepository.saveThreadJson(summaryThreadId, { ...summaryThread('New'), historyId: '2' });
		assert.deepEqual(await subjectsOf(threadRepository), ['New']);

		await threadRepository.saveThreadJson('28c2f0a1b2c3d4e5', summaryThread('Another', '28c2f0a1b2c3d4e5'));
		assert.deepEqual(await subjectsOf(threadRepository), ['Another', 'New']);
	});
});

test('listThreadSummaries drops deleted and evicted threads', async () => {
	await withSummaryRepository(async ({ threadRepository }) => {
		const otherId = '28c2f0a1b2c3d4e5';
		await threadRepository.saveThreadJson(summaryThreadId, summaryThread('First'));
		await threadRepository.saveThreadJson(otherId, summaryThread('Second', otherId));
		assert.deepEqual(await subjectsOf(threadRepository), ['First', 'Second']);

		await threadRepository.deleteThread(summaryThreadId);
		assert.deepEqual(await subjectsOf(threadRepository), ['Second']);

		await threadRepository.evictThread(otherId, '5');
		assert.deepEqual(await subjectsOf(threadRepository), []);
	});
});

test('the initial scan lists every thread without reading all their files at once', async () => {
	const threadIds = Array.from({ length: 100 }, (_, i) => `18c2f0a1b2c3d${i.toString(16).padStart(3, '0')}`);
	let openReads = 0;
	let mostOpenReads = 0;
	const fileioImpl = {
		readJsonFromFile: async (filePath) => {
			openReads += 1;
			mostOpenReads = Math.max(mostOpenReads, openReads);
			await new Promise((resolve) => setImmediate(resolve));
			openReads -= 1;
			return summaryThread(path.basename(filePath), path.basename(filePath));
		},
		...noopFileio,
	};
	await withSummaryRepository(async ({ threadsDirectory, threadRepository }) => {
		await Promise.all(threadIds.map((threadId) => writeFile(path.join(threadsDirectory, threadId), 'placeholder')));
		assert.deepEqual(await subjectsOf(threadRepository), [...threadIds].sort());
		assert.ok(mostOpenReads < threadIds.length, `read ${mostOpenReads} files at once`);
	}, fileioImpl);
});

test('a save that lands while the initial scan is reading wins over what the scan read', async () => {
	const { fileioImpl, readStarted, readReleased } = heldReadFileio();
	await withSummaryRepository(async ({ threadsDirectory, threadRepository }) => {
		await writeFile(path.join(threadsDirectory, summaryThreadId), 'placeholder');
		const listing = threadRepository.listThreadSummaries();
		await readStarted.promise;
		await threadRepository.saveThreadJson(summaryThreadId, summaryThread('New'));
		readReleased.resolve();
		assert.deepEqual((await listing).map((s) => s.subject), ['New']);
	}, fileioImpl);
});

test('a delete that lands while the initial scan is reading is not undone by the scan', async () => {
	const { fileioImpl, readStarted, readReleased } = heldReadFileio();
	await withSummaryRepository(async ({ threadsDirectory, threadRepository }) => {
		await writeFile(path.join(threadsDirectory, summaryThreadId), 'placeholder');
		const listing = threadRepository.listThreadSummaries();
		await readStarted.promise;
		await threadRepository.deleteThread(summaryThreadId);
		readReleased.resolve();
		assert.deepEqual(await listing, []);
	}, fileioImpl);
});
