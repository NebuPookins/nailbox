import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import nebulog from 'nebulog';

const logger = nebulog.make({filename: 'helpers/fileio.js', level: 'info'});

/**
 * Returns a promise of a JSON structure representing the parsed contents of
 * the file at the specified path. If the file does not exist, {} is returned.
 */
export async function readJsonFromOptionalFile(filePath) {
	logger.info(`Reading optional JSON from ${filePath}.`);
	try {
		const fileContents = await readFile(filePath, 'utf8');
		return JSON.parse(fileContents);
	} catch (error) {
		if (error.code === 'ENOENT') {
			logger.info(`No file found at ${filePath}, using empty json by default.`);
			return {};
		}
		if (error instanceof SyntaxError) {
			logger.warn(`Failed parsing JSON at ${filePath}: ${error.message}`);
		}
		throw error;
	}
}

/**
 * Returns a promise. If the promise resolves successfully, then as a side
 * effect the specified directory exists on the filesystem.
 */
export async function ensureDirectoryExists(dir) {
	await mkdir(dir, {recursive: true, mode: 0o0700});
	return dir;
}

/**
 * Returns a promise. If the promise resolves successfully, then as a side
 * effect the data in json was serialized and saved to the provided path.
 */
export async function saveJsonToFile(json, filePath) {
	const directory = path.dirname(filePath);
	const tempPath = `${filePath}.tmp`;
	await ensureDirectoryExists(directory);
	await writeFile(tempPath, JSON.stringify(json));
	await rename(tempPath, filePath);
	return json;
}

export default {
	readJsonFromOptionalFile,
	ensureDirectoryExists,
	saveJsonToFile,
};
