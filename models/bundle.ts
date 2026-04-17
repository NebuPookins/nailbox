import assert from 'assert';
import crypto from 'crypto';

import fileio from '../helpers/fileio.js';

const PATH_TO_BUNDLES = 'data/bundles.json';

export interface Bundle {
	bundleId: string;
	threadIds: string[];
	createdAt: number;
}

type BundleJsonData = Record<string, Bundle>;

export class BundleData {
	private _jsonData: BundleJsonData;

	constructor(jsonData: BundleJsonData) {
		assert((typeof jsonData) === 'object', `Expected jsonData to be an object but was ${typeof jsonData}.`);
		this._jsonData = jsonData;
	}

	getBundle(bundleId: string): Bundle | null {
		return this._jsonData[bundleId] ?? null;
	}

	listBundles(): Bundle[] {
		return Object.values(this._jsonData);
	}

	/**
	 * Returns the bundle that contains the given threadId, or null.
	 */
	getBundleForThread(threadId: string): Bundle | null {
		for (const bundle of this.listBundles()) {
			if (bundle.threadIds.includes(threadId)) {
				return bundle;
			}
		}
		return null;
	}

	/**
	 * @param threadIds at least 2 thread IDs
	 * @return the new bundleId
	 */
	createBundle(threadIds: string[]): string {
		assert(Array.isArray(threadIds) && threadIds.length >= 2, 'createBundle requires at least 2 threadIds.');
		const bundleId = 'bnd_' + crypto.randomBytes(8).toString('hex');
		this._jsonData[bundleId] = {
			bundleId,
			threadIds,
			createdAt: Date.now(),
		};
		return bundleId;
	}

	updateBundle(bundleId: string, threadIds: string[]): void {
		assert(Array.isArray(threadIds) && threadIds.length >= 2, 'updateBundle requires at least 2 threadIds.');
		assert(this._jsonData[bundleId], `Bundle ${bundleId} not found.`);
		this._jsonData[bundleId].threadIds = threadIds;
	}

	deleteBundle(bundleId: string): void {
		delete this._jsonData[bundleId];
	}

	save(): Promise<unknown> {
		return fileio.saveJsonToFile(this._jsonData, PATH_TO_BUNDLES);
	}
}

/**
 * @return [Promise<BundleData>]
 */
export async function load(): Promise<BundleData> {
	const fileContents = await fileio.readJsonFromOptionalFile(PATH_TO_BUNDLES) as BundleJsonData;
	return new BundleData(fileContents);
}

export default { load };
