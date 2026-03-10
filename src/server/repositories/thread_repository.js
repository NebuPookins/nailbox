import { readdir, rm } from 'node:fs/promises';

import nebulog from 'nebulog';

import fileio from '../../../helpers/fileio.js';
import threadModel from '../../../models/thread.js';
import { validatePersistedThread } from '../validation/contracts.js';

const logger = nebulog.make({filename: 'src/server/repositories/thread_repository.js', level: 'info'});
const THREADS_DIRECTORY = 'data/threads';

export async function deleteThread(threadId) {
	const pathToDelete = `${THREADS_DIRECTORY}/${threadId}`;
	try {
		await rm(pathToDelete);
		logger.info(`Deleted file ${pathToDelete}`);
		return true;
	} catch (error) {
		if (error.code === 'ENOENT') {
			logger.info(`File ${pathToDelete} already deleted.`);
			return true;
		}
		logger.error(`Error deleting ${pathToDelete}. Code: ${error.code}. Stack: ${error.stack}`);
		return false;
	}
}

export async function listThreadIds() {
	return readdir(THREADS_DIRECTORY);
}

export async function readThread(threadId) {
	const threadJson = await readThreadJson(threadId);
	return new threadModel.Thread(threadJson);
}

export async function readThreadJson(threadId) {
	const threadJson = await fileio.readJsonFromOptionalFile(`${THREADS_DIRECTORY}/${threadId}`);
	if (!threadJson.id && !threadJson.messages) {
		return threadJson;
	}
	return validatePersistedThread(threadJson);
}

export async function saveThreadJson(threadId, threadPayload) {
	validatePersistedThread(threadPayload);
	return fileio.saveJsonToFile(threadPayload, `${THREADS_DIRECTORY}/${threadId}`);
}

export default {
	deleteThread,
	listThreadIds,
	readThread,
	readThreadJson,
	saveThreadJson,
};
