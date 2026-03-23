import { readdir, rm } from 'node:fs/promises';

import nebulog from 'nebulog';

import fileio from '../../../helpers/fileio.js';
import { validatePersistedThread } from '../validation/contracts.js';

const logger = nebulog.make({filename: 'src/server/repositories/thread_repository.js', level: 'info'});
const THREADS_DIRECTORY = 'data/threads';

/**
 * @param {{
 *  fileioImpl?: typeof fileio,
 *  threadModelModule?: {Thread: new (data: object) => import('../types/thread.js').ThreadModelLike},
 *  threadsDirectory?: string,
 * }} [dependencies]
 * @returns {import('../types/thread.js').ThreadRepository}
 */
export function createThreadRepository(dependencies = {}) {
	const {
		fileioImpl = fileio,
		threadModelModule,
		threadsDirectory = THREADS_DIRECTORY,
	} = dependencies;

	/**
	 * @param {string} threadId
	 */
	async function deleteThread(threadId) {
		const pathToDelete = `${threadsDirectory}/${threadId}`;
		try {
			await rm(pathToDelete);
			logger.info(`Deleted file ${pathToDelete}`);
			return true;
		} catch (error) {
			const err = /** @type {Error & {code?: string; stack?: string}} */ (error);
			if (err.code === 'ENOENT') {
				logger.info(`File ${pathToDelete} already deleted.`);
				return true;
			}
			logger.error(`Error deleting ${pathToDelete}. Code: ${err.code}. Stack: ${err.stack}`);
			return false;
		}
	}

	async function listThreadIds() {
		return readdir(threadsDirectory);
	}

	/**
	 * @param {string} threadId
	 */
	async function readThread(threadId) {
		if (!threadModelModule) throw new Error('threadModelModule is required to readThread');
		const threadJson = await readThreadJson(threadId);
		return new threadModelModule.Thread(validatePersistedThread(threadJson));
	}

	/**
	 * @param {string} threadId
	 */
	async function readThreadJson(threadId) {
		const threadJson = await fileioImpl.readJsonFromOptionalFile(`${threadsDirectory}/${threadId}`);
		if (!threadJson.id && !threadJson.messages) {
			return threadJson;
		}
		return validatePersistedThread(threadJson);
	}

	/**
	 * @param {string} threadId
	 * @param {any} threadPayload
	 */
	async function saveThreadJson(threadId, threadPayload) {
		validatePersistedThread(threadPayload);
		return fileioImpl.saveJsonToFile(threadPayload, `${threadsDirectory}/${threadId}`);
	}

	return {
		deleteThread,
		listThreadIds,
		readThread,
		readThreadJson,
		saveThreadJson,
	};
}
