import test from 'node:test';
import assert from 'node:assert/strict';

import registerThreadRoutes from '../src/server/routes/thread_routes.js';

function createFakeApp() {
	const routes = [];
	return {
		get(path, handler) {
			routes.push({ method: 'GET', path, handler });
		},
		post(path, handler) {
			routes.push({ method: 'POST', path, handler });
		},
		put(path, handler) {
			routes.push({ method: 'PUT', path, handler });
		},
		delete(path, handler) {
			routes.push({ method: 'DELETE', path, handler });
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
		type() {
			return this;
		},
	};
}

function findDeleteHandler(app, patternText) {
	const route = app.routes.find((entry) => (
		entry.method === 'DELETE' &&
		entry.path instanceof RegExp &&
		String(entry.path) === patternText
	));
	assert.ok(route, `Expected route ${patternText} to be registered`);
	return route.handler;
}

test('thread delete route removes the deleted thread from its bundle', async () => {
	const app = createFakeApp();
	const bundleUpdates = [];
	let saveCalls = 0;
	registerThreadRoutes(app, {
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
		logger: { error() {}, info() {}, warn() {} },
		threadRepository: {
			async deleteThread() {
				return true;
			},
		},
	});

	const handler = findDeleteHandler(app, '/^\\/api\\/threads\\/([a-z0-9]+)$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.deepEqual(bundleUpdates, [{
		bundleId: 'bundle-1',
		threadIds: ['def456', 'ghi789'],
	}]);
	assert.equal(saveCalls, 1);
	assert.equal(res.sentStatus, 200);
});

test('thread delete route dissolves the bundle when deleting leaves fewer than two threads', async () => {
	const app = createFakeApp();
	const deletedBundles = [];
	let saveCalls = 0;
	registerThreadRoutes(app, {
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
		logger: { error() {}, info() {}, warn() {} },
		threadRepository: {
			async deleteThread() {
				return true;
			},
		},
	});

	const handler = findDeleteHandler(app, '/^\\/api\\/threads\\/([a-z0-9]+)$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.deepEqual(deletedBundles, ['bundle-1']);
	assert.equal(saveCalls, 1);
	assert.equal(res.sentStatus, 200);
});

test('thread delete route does not touch bundles when the deletion fails', async () => {
	const app = createFakeApp();
	registerThreadRoutes(app, {
		bundles: {
			getBundleForThread() {
				throw new Error('should not look up bundle membership');
			},
		},
		logger: { error() {}, info() {}, warn() {} },
		threadRepository: {
			async deleteThread() {
				return false;
			},
		},
	});

	const handler = findDeleteHandler(app, '/^\\/api\\/threads\\/([a-z0-9]+)$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.equal(res.sentStatus, 500);
});
