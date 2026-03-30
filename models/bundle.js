// @ts-nocheck
import assert from 'assert';
import crypto from 'crypto';

import fileio from '../helpers/fileio.js';

const PATH_TO_BUNDLES = 'data/bundles.json';

function BundleData(jsonData) {
	assert((typeof jsonData) === 'object', `Expected jsonData to be an object but was ${typeof jsonData}.`);
	this._jsonData = jsonData;
}

BundleData.prototype.getBundle = function(bundleId) {
	return this._jsonData[bundleId] || null;
};

BundleData.prototype.listBundles = function() {
	return Object.values(this._jsonData);
};

/**
 * Returns the bundleId of the bundle that contains the given threadId, or null.
 */
BundleData.prototype.getBundleForThread = function(threadId) {
	for (const bundle of this.listBundles()) {
		if (bundle.threadIds.includes(threadId)) {
			return bundle;
		}
	}
	return null;
};

/**
 * @param threadIds [Array<string>] at least 2 thread IDs
 * @return [string] the new bundleId
 */
BundleData.prototype.createBundle = function(threadIds) {
	assert(Array.isArray(threadIds) && threadIds.length >= 2, 'createBundle requires at least 2 threadIds.');
	const bundleId = 'bnd_' + crypto.randomBytes(8).toString('hex');
	this._jsonData[bundleId] = {
		bundleId,
		threadIds,
		createdAt: Date.now(),
	};
	return bundleId;
};

BundleData.prototype.updateBundle = function(bundleId, threadIds) {
	assert(Array.isArray(threadIds) && threadIds.length >= 2, 'updateBundle requires at least 2 threadIds.');
	assert(this._jsonData[bundleId], `Bundle ${bundleId} not found.`);
	this._jsonData[bundleId].threadIds = threadIds;
};

BundleData.prototype.deleteBundle = function(bundleId) {
	delete this._jsonData[bundleId];
};

BundleData.prototype.save = function() {
	return fileio.saveJsonToFile(this._jsonData, PATH_TO_BUNDLES);
};

/**
 * @return [Promise<BundleData>]
 */
export async function load() {
	const fileContents = await fileio.readJsonFromOptionalFile(PATH_TO_BUNDLES);
	return new BundleData(fileContents);
}

export default { load };
