import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import registerThreadRoutes from '../src/server/routes/thread_routes.js';
import { createThreadRepository } from '../src/server/repositories/thread_repository.js';
import { createThreadService } from '../src/server/services/thread_service.js';

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

function findHandler(app, method, patternText) {
	const route = app.routes.find((entry) => (
		entry.method === method &&
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

	const handler = findHandler(app, 'DELETE', '/^\\/api\\/threads\\/([a-z0-9]+)$/');
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

	const handler = findHandler(app, 'DELETE', '/^\\/api\\/threads\\/([a-z0-9]+)$/');
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

	const handler = findHandler(app, 'DELETE', '/^\\/api\\/threads\\/([a-z0-9]+)$/');
	const res = createFakeResponse();

	await handler({ params: ['abc123'] }, res);

	assert.equal(res.sentStatus, 500);
});

async function withMissingThreadRoutes(callback) {
	const threadsDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-threads-'));
	try {
		const threadRepository = createThreadRepository({
			threadsDirectory,
			threadModelModule: {
				Thread: class {
					constructor() {
						throw new Error('should not construct a thread for a missing file');
					}
				},
			},
		});
		const app = createFakeApp();
		registerThreadRoutes(app, {
			logger: { info() {}, error() {} },
			threadRepository,
			threadService: createThreadService({ threadRepository }),
		});
		await callback(app);
	} finally {
		await rm(threadsDirectory, { recursive: true, force: true });
	}
}

test('thread messages route responds 404 for a thread that is not cached', async () => {
	await withMissingThreadRoutes(async (app) => {
		const handler = findHandler(app, 'GET', String(/^\/api\/threads\/([a-z0-9]+)\/messages$/));
		const res = createFakeResponse();
		await handler({ params: ['abc123'] }, res);
		assert.equal(res.statusCode, 404);
	});
});

test('single message route responds 404 for a thread that is not cached', async () => {
	await withMissingThreadRoutes(async (app) => {
		const handler = findHandler(app, 'GET', String(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)$/));
		const res = createFakeResponse();
		await handler({ params: ['abc123', 'def456'] }, res);
		assert.equal(res.statusCode, 404);
	});
});

function findStringRoute(app, method, path) {
	const route = app.routes.find((entry) => entry.method === method && entry.path === path);
	assert.ok(route, `Expected route ${path} to be registered`);
	return route.handler;
}

function registerRenderModeRoutes(initialModes) {
	const app = createFakeApp();
	const config = {senderRenderModes: initialModes};
	const savedConfigs = [];
	registerThreadRoutes(app, {
		config,
		configRepository: {
			async saveConfig(savedConfig) {
				savedConfigs.push(savedConfig);
				return savedConfig;
			},
		},
		logger: { error() {}, info() {}, warn() {} },
	});
	return {app, config, savedConfigs};
}

test('GET sender render modes returns the saved modes', async () => {
	const {app} = registerRenderModeRoutes({'al@example.com': 'reader'});
	const res = createFakeResponse();

	await findStringRoute(app, 'GET', '/api/sender-render-modes')({}, res);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(res.body, {'al@example.com': 'reader'});
});

test('PUT sender render modes saves the mode for the sender and responds with all modes', async () => {
	const {app, savedConfigs} = registerRenderModeRoutes({'bo@example.com': 'plain'});
	const res = createFakeResponse();

	await findStringRoute(app, 'PUT', '/api/sender-render-modes')(
		{body: {senderEmail: 'Al@Example.com', mode: 'reader'}},
		res,
	);

	const expected = {'bo@example.com': 'plain', 'al@example.com': 'reader'};
	assert.equal(res.statusCode, 200);
	assert.deepEqual(res.body, expected);
	assert.equal(savedConfigs.length, 1);
	assert.deepEqual(savedConfigs[0].senderRenderModes, expected);
});

test('PUT sender render modes rejects an invalid mode without saving', async () => {
	const {app, savedConfigs} = registerRenderModeRoutes({});
	const res = createFakeResponse();

	await findStringRoute(app, 'PUT', '/api/sender-render-modes')(
		{body: {senderEmail: 'al@example.com', mode: 'sparkly'}},
		res,
	);

	assert.equal(res.statusCode, 400);
	assert.equal(savedConfigs.length, 0);
});

function registerTrustedImageSenderRoutes(initialSenders) {
	const app = createFakeApp();
	const savedConfigs = [];
	registerThreadRoutes(app, {
		config: {trustedImageSenders: initialSenders},
		configRepository: {
			async saveConfig(savedConfig) {
				savedConfigs.push(savedConfig);
				return savedConfig;
			},
		},
		logger: { error() {}, info() {}, warn() {} },
	});
	return {app, savedConfigs};
}

test('GET trusted image senders returns the saved senders', async () => {
	const {app} = registerTrustedImageSenderRoutes(['al@example.com']);
	const res = createFakeResponse();

	await findStringRoute(app, 'GET', '/api/trusted-image-senders')({}, res);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(res.body, ['al@example.com']);
});

test('PUT trusted image senders adds the sender once and saves', async () => {
	const {app, savedConfigs} = registerTrustedImageSenderRoutes(['bo@example.com']);
	const handler = findStringRoute(app, 'PUT', '/api/trusted-image-senders');
	const res = createFakeResponse();

	await handler({body: {senderEmail: 'Al@Example.com'}}, res);
	await handler({body: {senderEmail: 'al@example.com'}}, createFakeResponse());

	assert.equal(res.statusCode, 200);
	assert.deepEqual(res.body, ['bo@example.com', 'al@example.com']);
	assert.deepEqual(savedConfigs.at(-1).trustedImageSenders, ['bo@example.com', 'al@example.com']);
});

test('PUT trusted image senders rejects a missing sender without saving', async () => {
	const {app, savedConfigs} = registerTrustedImageSenderRoutes([]);
	const res = createFakeResponse();

	await findStringRoute(app, 'PUT', '/api/trusted-image-senders')({body: {senderEmail: '  '}}, res);

	assert.equal(res.statusCode, 400);
	assert.equal(savedConfigs.length, 0);
});

test('PUT trusted image senders leaves the trusted senders unchanged when saving fails', async () => {
	const app = createFakeApp();
	const config = {trustedImageSenders: ['bo@example.com']};
	registerThreadRoutes(app, {
		config,
		configRepository: {
			async saveConfig() {
				throw new Error('disk full');
			},
		},
		logger: { error() {}, info() {}, warn() {} },
	});
	const res = createFakeResponse();

	await findStringRoute(app, 'PUT', '/api/trusted-image-senders')({body: {senderEmail: 'al@example.com'}}, res);

	assert.equal(res.statusCode, 500);
	assert.deepEqual(config.trustedImageSenders, ['bo@example.com']);
});
