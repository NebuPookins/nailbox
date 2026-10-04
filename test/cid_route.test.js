import test from 'node:test';
import assert from 'node:assert/strict';

import registerThreadActionRoutes from '../src/server/routes/thread_action_routes.js';
import {Message} from '../models/message.js';

const CID_ROUTE = '/^\\/api\\/threads\\/([a-z0-9]+)\\/messages\\/([a-z0-9]+)\\/cid\\/(.+)$/';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 254, 255]);

function createFakeResponse() {
	return {
		body: undefined,
		statusCode: null,
		headers: {},
		contentType: null,
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
		type(contentType) {
			this.contentType = contentType;
			return this;
		},
		set(headers) {
			this.headers = {...this.headers, ...headers};
			return this;
		},
	};
}

function messageWithParts(parts) {
	return new Message({
		id: 'm1',
		threadId: 't1',
		labelIds: ['INBOX'],
		snippet: '',
		internalDate: '1',
		payload: {
			mimeType: 'multipart/related',
			headers: [],
			body: {size: 0},
			parts: [{mimeType: 'text/html', body: {size: 1, data: 'eA'}}, ...parts],
		},
	});
}

function setup({message, gmailAttachments = {}}) {
	const routes = [];
	const gmailRequests = [];
	registerThreadActionRoutes({
		get(path, handler) {
			routes.push({path, handler});
		},
		post() {},
	}, {
		logger: {error() {}, info() {}, warn() {}},
		threadRepository: {
			async readThread(threadId) {
				assert.equal(threadId, 't1');
				return {message: (messageId) => (messageId === 'm1' ? message : undefined)};
			},
		},
		async withGmailApi(_res, callback) {
			return callback(async (request) => {
				gmailRequests.push(request.path);
				return gmailAttachments[request.path];
			});
		},
	});
	const route = routes.find((entry) => String(entry.path) === CID_ROUTE);
	assert.ok(route, 'cid route should be registered');
	return {handler: route.handler, gmailRequests};
}

async function get(handler, contentId) {
	const res = createFakeResponse();
	await handler({params: ['t1', 'm1', contentId]}, res);
	return res;
}

test('cid route serves inline image data with its content type', async () => {
	const message = messageWithParts([{
		mimeType: 'image/png',
		headers: [{name: 'Content-ID', value: '<logo@example.com>'}],
		body: {size: PNG_BYTES.length, data: PNG_BYTES.toString('base64url')},
	}]);
	const {handler} = setup({message});

	const res = await get(handler, 'logo@example.com');

	assert.equal(res.statusCode, 200);
	assert.equal(res.contentType, 'image/png');
	assert.deepEqual(res.body, PNG_BYTES);
});

test('cid route matches the Content-ID header case-insensitively by name', async () => {
	const message = messageWithParts([{
		mimeType: 'image/gif',
		headers: [{name: 'content-id', value: 'plain-id'}],
		body: {size: 1, data: PNG_BYTES.toString('base64url')},
	}]);
	const {handler} = setup({message});

	assert.equal((await get(handler, 'plain-id')).statusCode, 200);
});

test('cid route fetches image bytes from Gmail when the part only has an attachment id', async () => {
	const message = messageWithParts([{
		mimeType: 'image/jpeg',
		headers: [{name: 'Content-ID', value: '<big>'}],
		body: {size: 99, attachmentId: 'att1'},
	}]);
	const {handler, gmailRequests} = setup({
		message,
		gmailAttachments: {'/messages/m1/attachments/att1': {data: PNG_BYTES.toString('base64url')}},
	});

	const res = await get(handler, 'big');

	assert.equal(res.statusCode, 200);
	assert.equal(res.contentType, 'image/jpeg');
	assert.deepEqual(res.body, PNG_BYTES);
	assert.deepEqual(gmailRequests, ['/messages/m1/attachments/att1']);
});

test('cid route responds 404 for an unknown Content-ID', async () => {
	const {handler} = setup({message: messageWithParts([])});
	assert.equal((await get(handler, 'nope')).statusCode, 404);
});

test('cid route responds 404 for an unknown message', async () => {
	const {handler} = setup({message: messageWithParts([])});
	const res = createFakeResponse();
	await handler({params: ['t1', 'other', 'x']}, res);
	assert.equal(res.statusCode, 404);
});

test('cid route refuses to serve parts that are not images', async () => {
	const message = messageWithParts([{
		mimeType: 'text/html',
		headers: [{name: 'Content-ID', value: '<page>'}],
		body: {size: 1, data: Buffer.from('<script>alert(1)</script>').toString('base64url')},
	}]);
	const {handler} = setup({message});

	assert.equal((await get(handler, 'page')).statusCode, 404);
});
