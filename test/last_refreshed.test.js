import test from 'node:test';
import assert from 'node:assert/strict';

import { LastRefreshedData } from '../models/last_refreshed.js';

test('markRefreshed coalesces multiple updates into one persisted write', async () => {
	let saveCallCount = 0;
	const savedSnapshots = [];
	const underTest = new LastRefreshedData({}, {
		flushDelayMs: 5,
		saveJsonToFile: async (jsonData) => {
			saveCallCount += 1;
			savedSnapshots.push({...jsonData});
		},
	});

	const firstPromise = underTest.markRefreshed('thread-a');
	const secondPromise = underTest.markRefreshed('thread-b');

	assert.equal(firstPromise, secondPromise);
	await secondPromise;

	assert.equal(saveCallCount, 1);
	assert.equal(typeof savedSnapshots[0]['thread-a'], 'number');
	assert.equal(typeof savedSnapshots[0]['thread-b'], 'number');
});
