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
