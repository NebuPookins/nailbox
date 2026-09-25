import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';

import nebulog from 'nebulog';

const logger = nebulog.make({filename: 'helpers/fileio.ts', level: 'info'});

/**
 * Returns a promise of a JSON structure representing the parsed contents of
 * the file at the specified path. If the file does not exist, {} is returned.
 */
export async function readJsonFromOptionalFile(filePath: string): Promise<unknown> {
	logger.info(`Reading optional JSON from ${filePath}.`);
	try {
		const fileContents = await readFile(filePath, 'utf8');
		return JSON.parse(fileContents);
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === 'ENOENT') {
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
export async function ensureDirectoryExists(dir: string): Promise<string> {
	await mkdir(dir, {recursive: true, mode: 0o0700});
	return dir;
}

const pendingWritesByPath = new Map<string, Promise<void>>();

async function writeJsonAtomically(serializedJson: string, filePath: string): Promise<void> {
	const directory = path.dirname(filePath);
	const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await ensureDirectoryExists(directory);
	await writeFile(tempPath, serializedJson);
	await rename(tempPath, filePath);
}

/**
 * Returns a promise. If the promise resolves successfully, then as a side
 * effect the data in json was serialized and saved to the provided path.
 *
 * json is serialized immediately, and writes to the same path are applied in
 * call order, so the file always ends up holding the most recently requested
 * contents even when several saves overlap. (Ordering is per process only.)
 */
export async function saveJsonToFile(json: unknown, filePath: string): Promise<void> {
	const serializedJson = JSON.stringify(json);
	const key = path.resolve(filePath);
	const previousWrite = pendingWritesByPath.get(key) ?? Promise.resolve();
	const runWrite = () => writeJsonAtomically(serializedJson, filePath);
	const write = previousWrite.then(runWrite, runWrite);
	pendingWritesByPath.set(key, write);
	const forgetIfLatest = () => {
		if (pendingWritesByPath.get(key) === write) {
			pendingWritesByPath.delete(key);
		}
	};
	write.then(forgetIfLatest, forgetIfLatest);
	return write;
}

export default {
	readJsonFromOptionalFile,
	ensureDirectoryExists,
	saveJsonToFile,
};
