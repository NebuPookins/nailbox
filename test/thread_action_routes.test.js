import test from 'node:test';
import assert from 'node:assert/strict';

import registerThreadActionRoutes from '../src/server/routes/thread_action_routes.js';

function createFakeApp() {
	const routes = [];
	return {
		get(path, handler) {
			routes.push({ method: 'GET', path, handler });
		},
		post(path, handler) {
			routes.push({ method: 'POST', path, handler });
		},
		routes,
	};
}

function createFakeResponse() {
	return {
		body: undefined,
		statusCode: null,
		sentStatus: null,
		send(payload) {
			this.body = payload;
			return this;
		},
		sendStatus(statusCode) {
			this.sentStatus = statusCode;
			this.statusCode = statusCode;
			return this;
		},
		status(statusCode) {
			this.statusCode = statusCode;
			return this;
		},
	};
}

function findPostHandler(app, patternText) {
	const route = app.routes.find((entry) => (
		entry.method === 'POST' &&
		entry.path instanceof RegExp &&
		String(entry.path) === patternText
	));
	assert.ok(route, `Expected route ${patternText} to be registered`);
	return route.handler;
}

test('thread trash route deletes cached thread after Gmail accepts the request', async () => {
	const app = createFakeApp();
	let deletedThreadId = null;
	registerThreadActionRoutes(app, {
		lastRefresheds: {},
		logger: { error() {}, info() {}, warn() {} },
		threadRepository: {
			async deleteThread(threadId) {
				deletedThreadId = threadId;
				return true;
			},
		},
		async withGmailApi(_res, callback) {
			return callback(async (request) => {
				assert.equal(request.method, 'POST');
				assert.equal(request.path, '/threads/abc123/trash');
				return { id: 'gmail-response' };
			});
		},
	});

	const handler = findPostHandler(app, '/^\\/api\\/threads\\/([a-z0-9]+)\\/trash$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.equal(deletedThreadId, 'abc123');
	assert.equal(res.statusCode, 200);
	assert.deepEqual(res.body, { id: 'gmail-response' });
});

test('thread archive route fails if cached thread deletion fails', async () => {
	const app = createFakeApp();
	registerThreadActionRoutes(app, {
		lastRefresheds: {},
		logger: { error() {}, info() {}, warn() {} },
		threadRepository: {
			async deleteThread() {
				return false;
			},
		},
		async withGmailApi(_res, callback) {
			return callback(async (request) => {
				assert.equal(request.method, 'POST');
				assert.equal(request.path, '/threads/abc123/modify');
				assert.deepEqual(request.json, {
					removeLabelIds: ['INBOX'],
				});
				return { id: 'gmail-response' };
			});
		},
	});

	const handler = findPostHandler(app, '/^\\/api\\/threads\\/([a-z0-9]+)\\/archive$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.equal(res.sentStatus, 500);
});

test('thread trash route updates bundle membership when deleting one bundled thread', async () => {
	const app = createFakeApp();
	const bundleUpdates = [];
	let saveCalls = 0;
	registerThreadActionRoutes(app, {
		bundles: {
			getBundleForThread(threadId) {
				assert.equal(threadId, 'abc123');
				return {
					bundleId: 'bundle-1',
					threadIds: ['abc123', 'def456', 'ghi789'],
				};
			},
			updateBundle(bundleId, threadIds) {
				bundleUpdates.push({ bundleId, threadIds });
			},
			deleteBundle() {
				throw new Error('should not delete bundle');
			},
			async save() {
				saveCalls += 1;
			},
		},
		lastRefresheds: {},
		logger: { error() {}, info() {}, warn() {} },
		threadRepository: {
			async deleteThread() {
				return true;
			},
		},
		async withGmailApi(_res, callback) {
			return callback(async () => ({ id: 'gmail-response' }));
		},
	});

	const handler = findPostHandler(app, '/^\\/api\\/threads\\/([a-z0-9]+)\\/trash$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.deepEqual(bundleUpdates, [{
		bundleId: 'bundle-1',
		threadIds: ['def456', 'ghi789'],
	}]);
	assert.equal(saveCalls, 1);
	assert.equal(res.statusCode, 200);
});

test('thread trash route deletes the bundle when deleting leaves fewer than two threads', async () => {
	const app = createFakeApp();
	const deletedBundles = [];
	let saveCalls = 0;
	registerThreadActionRoutes(app, {
		bundles: {
			getBundleForThread(threadId) {
				assert.equal(threadId, 'abc123');
				return {
					bundleId: 'bundle-1',
					threadIds: ['abc123', 'def456'],
				};
			},
			updateBundle() {
				throw new Error('should not update bundle');
			},
			deleteBundle(bundleId) {
				deletedBundles.push(bundleId);
			},
			async save() {
				saveCalls += 1;
			},
		},
		lastRefresheds: {},
		logger: { error() {}, info() {}, warn() {} },
		threadRepository: {
			async deleteThread() {
				return true;
			},
		},
		async withGmailApi(_res, callback) {
			return callback(async () => ({ id: 'gmail-response' }));
		},
	});

	const handler = findPostHandler(app, '/^\\/api\\/threads\\/([a-z0-9]+)\\/trash$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.deepEqual(deletedBundles, ['bundle-1']);
	assert.equal(saveCalls, 1);
	assert.equal(res.statusCode, 200);
});
