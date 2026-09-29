import {readdir, rm} from 'node:fs/promises';

import nebulog from 'nebulog';

import fileio from '../../../helpers/fileio.js';
import {isThreadId, validatePersistedThread} from '../validation/contracts.js';
import type {PersistedThread, ThreadModelLike, ThreadRepository} from '../types/thread.js';

const logger = nebulog.make({filename: 'src/server/repositories/thread_repository.ts', level: 'info'});
const THREADS_DIRECTORY = 'data/threads';

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

	async function deleteThread(threadId: string): Promise<boolean> {
		const pathToDelete = threadPath(threadId);
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
	}

	return {
		deleteThread,
		listThreadIds,
		readThread,
		readThreadJson,
		saveThreadJson,
	};
}
