import test from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../helpers/logger.js';

function captureConsole(t) {
	const lines = [];
	for (const method of ['error', 'warn', 'info', 'debug']) {
		t.mock.method(console, method, (...args) => lines.push({method, args}));
	}
	return lines;
}

test('createLogger prints messages at or above its level and drops the rest', (t) => {
	const lines = captureConsole(t);
	const logger = createLogger({filename: 'models/thread.ts', level: 'info'});

	logger.error('broke');
	logger.warn('careful');
	logger.info('hello');
	logger.debug('noise');

	assert.deepEqual(lines.map(({method}) => method), ['error', 'warn', 'info']);
});

test('createLogger prefixes the file name and inspects extra details', (t) => {
	const lines = captureConsole(t);
	const logger = createLogger({filename: 'src/server/services/thread_service.ts', level: 'debug'});

	logger.debug('details', {id: 1});

	const [{args}] = lines;
	assert.deepEqual(args.slice(1), ['[thread_service.ts]', 'details', '{ id: 1 }']);
	assert.match(args[0], /debug:/);
});
