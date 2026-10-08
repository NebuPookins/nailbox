import {open, readdir, rm} from 'node:fs/promises';
import util from 'node:util';

import nebulog from 'nebulog';

import fileio from '../../../helpers/fileio.js';
import {createKeyedSerializer} from '../../../helpers/keyed_serializer.js';
import {isThreadId, validatePersistedThread} from '../validation/contracts.js';
import type {EvictThreadOutcome, PersistedThread, ThreadModelLike, ThreadRepository} from '../types/thread.js';

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
	// Writes to one thread's file run one at a time, so a save's compare
	// against the cached copy can't race another save or a delete.
	const serializeWrite = createKeyedSerializer();
	// Bumped by every deleteThread, so a save can tell that its payload was
	// fetched from Gmail before the thread was deleted, and so is stale.
	const deletionCounts = new Map<string, number>();
	// The historyId of the payload that last evicted each thread, so an older
	// payload saved afterwards can't bring the thread back.
	const evictedHistoryIds = new Map<string, string>();

	function readDeletionCount(threadId: string): number {
		return deletionCounts.get(threadId) ?? 0;
	}

	function deleteThread(threadId: string): Promise<boolean> {
		// Bumped now rather than once the delete's turn comes, so a save
		// already queued behind it is refused too.
		deletionCounts.set(threadId, readDeletionCount(threadId) + 1);
		return serializeWrite(threadId, async () => (await deleteThreadFile(threadId)) !== 'failed');
	}

	function evictThread(threadId: string, historyId: string | undefined): Promise<EvictThreadOutcome> {
		return serializeWrite(threadId, async () => {
			const cachedHistoryId = await readHistoryIdIfReadable(threadId);
			if (isOlderThan(historyId, cachedHistoryId)) {
				logger.info(`Not evicting thread ${threadId}: historyId ${historyId} is older than the cached ${cachedHistoryId}.`);
				return 'kept';
			}
			if (historyId !== undefined && !isOlderThan(historyId, evictedHistoryIds.get(threadId))) {
				evictedHistoryIds.set(threadId, historyId);
			}
			return deleteThreadFile(threadId);
		});
	}

	async function deleteThreadFile(threadId: string): Promise<'deleted' | 'absent' | 'failed'> {
		const pathToDelete = threadPath(threadId);
		// Recorded as "no cached copy" rather than forgotten, so a read already
		// in flight can't put the deleted file's historyId back. If the rm
		// fails, the mismatch just costs one extra re-fetch, whose save fixes it.
		historyIds.set(threadId, undefined);
		try {
			await rm(pathToDelete);
			logger.info(`Deleted file ${pathToDelete}`);
			return 'deleted';
		} catch (error) {
			const err = error as Error & {code?: string; stack?: string};
			if (err.code === 'ENOENT') {
				logger.info(`File ${pathToDelete} already deleted.`);
				return 'absent';
			}
			logger.error(`Error deleting ${pathToDelete}. Code: ${err.code}. Stack: ${err.stack}`);
			return 'failed';
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
		return (await readCachedThread(threadId)) ?? {};
	}

	// A missing file, or leftover JSON with neither an id nor messages, counts
	// as uncached so the next save simply overwrites it.
	async function readCachedThread(threadId: string): Promise<PersistedThread | undefined> {
		const threadJson = await fileioImpl.readJsonFromOptionalFile(threadPath(threadId));
		if (typeof threadJson !== 'object' || threadJson === null || !('id' in threadJson || 'messages' in threadJson)) {
			return undefined;
		}
		return validatePersistedThread(threadJson);
	}

	function saveThreadJson(
		threadId: string,
		threadPayload: PersistedThread,
		{deletionCountAtFetch}: {deletionCountAtFetch?: number} = {},
	): Promise<boolean> {
		return serializeWrite(threadId, async () => {
			validatePersistedThread(threadPayload);
			if (deletionCountAtFetch !== undefined && deletionCountAtFetch !== readDeletionCount(threadId)) {
				logger.info(`Not saving thread ${threadId}: it was deleted after this copy was fetched.`);
				return false;
			}
			const cachedHistoryId = await readHistoryIdIfReadable(threadId);
			const newerHistoryId = [cachedHistoryId, evictedHistoryIds.get(threadId)]
				.find((historyId) => isOlderThan(threadPayload.historyId, historyId));
			if (newerHistoryId !== undefined) {
				logger.info(`Not saving thread ${threadId}: historyId ${threadPayload.historyId} is older than ${newerHistoryId}.`);
				return false;
			}
			// Comparing historyIds first means the usual save of a changed
			// thread needn't parse the old file.
			if (cachedHistoryId === threadPayload.historyId && await isCachedCopy(threadId, threadPayload)) {
				return false;
			}
			await fileioImpl.saveJsonToFile(threadPayload, threadPath(threadId));
			historyIds.set(threadId, threadPayload.historyId);
			evictedHistoryIds.delete(threadId);
			return true;
		});
	}

	// A cached copy that is unreadable or fails validation doesn't match, so
	// the save replaces it.
	async function isCachedCopy(threadId: string, threadPayload: PersistedThread): Promise<boolean> {
		try {
			return util.isDeepStrictEqual(await readCachedThread(threadId), threadPayload);
		} catch (error) {
			if (isUnreadableCacheError(error)) {
				logger.warn(`Replacing unreadable cached copy of thread ${threadId}: ${(error as Error).message}`);
				return false;
			}
			throw error;
		}
	}

	// Treats an unreadable cached copy as having no historyId, so a save
	// replaces it and an eviction removes it.
	async function readHistoryIdIfReadable(threadId: string): Promise<string | undefined> {
		try {
			return await readHistoryId(threadId);
		} catch (error) {
			if (isUnreadableCacheError(error)) {
				return undefined;
			}
			throw error;
		}
	}

	return {
		deleteThread,
		evictThread,
		listThreadIds,
		readDeletionCount,
		readHistoryId,
		readThread,
		readThreadJson,
		saveThreadJson,
	};
}

function isUnreadableCacheError(error: unknown): boolean {
	return error instanceof SyntaxError || (error as {code?: string}).code === 'INVALID_CONTRACT';
}

// Gmail historyIds are decimal uint64s that only grow, so the larger one is
// newer. False if either is missing or not a number, as then neither is known
// to be older.
function isOlderThan(historyId: string | undefined, otherHistoryId: string | undefined): boolean {
	const isDecimal = (value: string | undefined): value is string => value !== undefined && /^\d+$/.test(value);
	return isDecimal(historyId) && isDecimal(otherHistoryId) && BigInt(historyId) < BigInt(otherHistoryId);
}
