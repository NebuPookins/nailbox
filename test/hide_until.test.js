import test from 'node:test';
import assert from 'node:assert/strict';

import { HideUntilData } from '../models/hide_until.js';

function sortThreadIds(hideUntilJson, threads) {
	return threads.toSorted(new HideUntilData(hideUntilJson).comparator()).map((thread) => thread.threadId);
}

test('a thread updated since it was hidden until I have time sorts with new threads by recency', () => {
	const hideUntilJson = {
		replied: {type: 'when-i-have-time', hiddenOn: 100},
	};
	const threads = [
		{threadId: 'older', lastUpdated: 150},
		{threadId: 'replied', lastUpdated: 300},
		{threadId: 'newer', lastUpdated: 200},
	];

	assert.deepEqual(sortThreadIds(hideUntilJson, threads), ['replied', 'newer', 'older']);
});

test('a thread updated since it was hidden until I have time sorts before hidden threads that were not', () => {
	const hideUntilJson = {
		replied: {type: 'when-i-have-time', hiddenOn: 100},
		quiet: {type: 'when-i-have-time', hiddenOn: 100},
		snoozed: {type: 'timestamp', value: 50, hiddenOn: 100},
	};
	const threads = [
		{threadId: 'quiet', lastUpdated: 90},
		{threadId: 'snoozed', lastUpdated: 90},
		{threadId: 'replied', lastUpdated: 300},
	];

	assert.deepEqual(sortThreadIds(hideUntilJson, threads), ['replied', 'snoozed', 'quiet']);
});

test('threads updated since they were hidden sort by recency however they were hidden', () => {
	const hideUntilJson = {
		snoozed: {type: 'timestamp', value: 500, hiddenOn: 100},
		deferred: {type: 'when-i-have-time', hiddenOn: 100},
	};
	const threads = [
		{threadId: 'snoozed', lastUpdated: 200},
		{threadId: 'deferred', lastUpdated: 300},
	];

	assert.deepEqual(sortThreadIds(hideUntilJson, threads), ['deferred', 'snoozed']);
	assert.deepEqual(sortThreadIds(hideUntilJson, threads.toReversed()), ['deferred', 'snoozed']);
});

test('threads updated at the same time compare as equal', () => {
	const comparator = new HideUntilData({
		deferred: {type: 'when-i-have-time', hiddenOn: 100},
	}).comparator();
	const deferred = {threadId: 'deferred', lastUpdated: 200};
	const fresh = {threadId: 'fresh', lastUpdated: 200};

	assert.equal(comparator(deferred, fresh), 0);
	assert.equal(comparator(fresh, deferred), 0);
});
