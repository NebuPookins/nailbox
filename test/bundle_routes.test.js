import test from 'node:test';
import assert from 'node:assert/strict';

import registerBundleRoutes from '../src/server/routes/bundle_routes.js';

function createFakeApp() {
	const routes = [];
	const app = {routes};
	for (const method of ['get', 'post', 'put', 'delete']) {
		app[method] = (path, handler) => routes.push({method: method.toUpperCase(), path, handler});
	}
	return app;
}

function createFakeResponse() {
	return {
		body: undefined,
		statusCode: null,
		send(payload) {
			this.body = payload;
			return this;
		},
		sendStatus(statusCode) {
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

function findHandler(app, method, path) {
	const route = app.routes.find((entry) => entry.method === method && entry.path === path);
	assert.ok(route, `Expected ${method} ${path} to be registered`);
	return route.handler;
}

function createDependencies() {
	return {
		bundles: {
			createBundle() {
				throw new Error('should not create a bundle');
			},
			getBundle() {
				return {bundleId: 'bundle-1', threadIds: ['one', 'two']};
			},
			getBundleForThread() {
				return null;
			},
			updateBundle() {
				throw new Error('should not update a bundle');
			},
		},
		logger: {error() {}, info() {}},
	};
}

test('create bundle rejects duplicate thread IDs', async () => {
	const app = createFakeApp();
	registerBundleRoutes(app, createDependencies());
	const res = createFakeResponse();

	await findHandler(app, 'POST', '/api/bundles')({body: {threadIds: ['one', 'one']}}, res);

	assert.equal(res.statusCode, 400);
	assert.deepEqual(res.body, {humanErrorMessage: 'threadIds must not contain duplicates.'});
});

test('update bundle rejects duplicate thread IDs', async () => {
	const app = createFakeApp();
	registerBundleRoutes(app, createDependencies());
	const res = createFakeResponse();

	await findHandler(app, 'PUT', '/api/bundles/:bundleId')({
		params: {bundleId: 'bundle-1'},
		body: {threadIds: ['one', 'one']},
	}, res);

	assert.equal(res.statusCode, 400);
	assert.deepEqual(res.body, {humanErrorMessage: 'threadIds must not contain duplicates.'});
});
