import {open, readdir, rm} from 'node:fs/promises';

import nebulog from 'nebulog';

import fileio from '../../../helpers/fileio.js';
import {isThreadId, validatePersistedThread} from '../validation/contracts.js';
import type {PersistedThread, ThreadModelLike, ThreadRepository} from '../types/thread.js';

const logger = nebulog.make({filename: 'src/server/repositories/thread_repository.ts', level: 'info'});
const THREADS_DIRECTORY = 'data/threads';
// Enough to cover {"id":"<16 hex>","historyId":"<digits>" with room to spare.
const HISTORY_ID_HEAD_BYTES = 128;

export function createThreadRepository(dependencies: {
	fileioImpl?: typeof fileio;
	threadModelModule?: {Thread: new (data: object) => ThreadModelLike};
	threadsDirectory?: string;
} = {}): ThreadRepository {
	const {
		fileioImpl = fileio,
		threadModelModule,
		threadsDirectory = THREADS_DIRECTORY,
	} = dependencies;

	const threadPath = (threadId: string): string => `${threadsDirectory}/${threadId}`;
	// Remembers each cached thread's Gmail historyId so a sync can tell which
	// threads changed without re-parsing every cached file on every poll. Kept
	// current by saveThreadJson and deleteThread, the only writers of the cache.
	const historyIds = new Map<string, string | undefined>();

	async function deleteThread(threadId: string): Promise<boolean> {
		const pathToDelete = threadPath(threadId);
		// Recorded as "no cached copy" rather than forgotten, so a read already
		// in flight can't put the deleted file's historyId back. If the rm
		// fails, the mismatch just costs one extra re-fetch, whose save fixes it.
		historyIds.set(threadId, undefined);
		try {
			await rm(pathToDelete);
			logger.info(`Deleted file ${pathToDelete}`);
			return true;
		} catch (error) {
			const err = error as Error & {code?: string; stack?: string};
			if (err.code === 'ENOENT') {
				logger.info(`File ${pathToDelete} already deleted.`);
				return true;
			}
			logger.error(`Error deleting ${pathToDelete}. Code: ${err.code}. Stack: ${err.stack}`);
			return false;
		}
	}

	async function listThreadIds(): Promise<string[]> {
		// Skips anything that isn't a cached thread, e.g. in-flight temp files.
		const filenames = await readdir(threadsDirectory);
		return filenames.filter(isThreadId);
	}

	async function readHistoryId(threadId: string): Promise<string | undefined> {
		if (!historyIds.has(threadId)) {
			const historyId = await readHistoryIdFromFile(threadId);
			// A save or delete during the read already recorded a newer value;
			// the one just read from disk may be stale.
			if (!historyIds.has(threadId)) {
				historyIds.set(threadId, historyId);
			}
		}
		return historyIds.get(threadId);
	}

	// Cached threads are Gmail payloads saved as-is, which start with
	// {"id":"…","historyId":"…", so the historyId can be read from the first
	// few bytes instead of parsing a file that can be megabytes long. Anything
	// else falls back to a full parse.
	async function readHistoryIdFromFile(threadId: string): Promise<string | undefined> {
		let head = '';
		try {
			const file = await open(threadPath(threadId));
			try {
				const {buffer, bytesRead} = await file.read({buffer: Buffer.alloc(HISTORY_ID_HEAD_BYTES)});
				head = buffer.toString('utf8', 0, bytesRead);
			} finally {
				await file.close();
			}
		} catch (error) {
			if ((error as {code?: string}).code !== 'ENOENT') {
				throw error;
			}
			return undefined;
		}
		const match = /^\{"id":"[0-9a-z]+","historyId":"(\d+)"/.exec(head);
		return match ? match[1] : (await readThreadJson(threadId)).historyId;
	}

	async function readThread(threadId: string): Promise<ThreadModelLike> {
		if (!threadModelModule) throw new Error('threadModelModule is required to readThread');
		// Unlike readThreadJson, a missing file rejects with ENOENT so callers can report 404.
		const threadJson = await fileioImpl.readJsonFromFile(threadPath(threadId));
		return new threadModelModule.Thread(validatePersistedThread(threadJson));
	}

	async function readThreadJson(threadId: string): Promise<Partial<PersistedThread>> {
		const threadJson = await fileioImpl.readJsonFromOptionalFile(threadPath(threadId));
		const partial = threadJson as Partial<PersistedThread>;
		if (!partial.id && !partial.messages) {
			return partial;
		}
		return validatePersistedThread(threadJson);
	}

	async function saveThreadJson(threadId: string, threadPayload: PersistedThread): Promise<void> {
		validatePersistedThread(threadPayload);
		await fileioImpl.saveJsonToFile(threadPayload, threadPath(threadId));
		historyIds.set(threadId, threadPayload.historyId);
	}

	return {
		deleteThread,
		listThreadIds,
		readHistoryId,
		readThread,
		readThreadJson,
		saveThreadJson,
	};
}
