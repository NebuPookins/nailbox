import test from 'node:test';
import assert from 'node:assert/strict';

import { goneItems, groupsWithAnimatingRows, itemKey } from '../src/frontend/animating_rows.js';

function thread(threadId) {
	return { type: 'thread', threadId };
}

function bundle(bundleId, threadIds) {
	return { type: 'bundle', bundleId, threadIds, memberThreads: threadIds.map(thread) };
}

function group(label, items) {
	return { label, items };
}

function animating(entries) {
	return new Map(entries.map(function(row) { return [itemKey(row.item), row]; }));
}

function ids(groups) {
	return groups.map(function(g) {
		return g.items.map(function(item) { return item.type === 'bundle' ? item.bundleId : item.threadId; });
	});
}

test('shows exactly the latest rows when nothing is animating', () => {
	const latest = [group('A', [thread('t1'), thread('t2')])];
	assert.deepEqual(ids(groupsWithAnimatingRows(latest, new Map())), [['t1', 't2']]);
});

test('shows an animating row at its old position next to the latest rows', () => {
	const latest = [group('A', [thread('t1'), thread('t3'), thread('t4')])];
	const rows = animating([{ token: 1, item: thread('t2'), groupLabel: 'A', precededBy: itemKey(thread('t1')) }]);
	assert.deepEqual(ids(groupsWithAnimatingRows(latest, rows)), [['t1', 't2', 't3', 't4']]);
});

test('shows an animating first row first', () => {
	const latest = [group('A', [thread('t2')])];
	const rows = animating([{ token: 1, item: thread('t1'), groupLabel: 'A', precededBy: null }]);
	assert.deepEqual(ids(groupsWithAnimatingRows(latest, rows)), [['t1', 't2']]);
});

test('puts an animating row at the end of its group when its predecessor is unknown', () => {
	const latest = [group('A', [thread('t1')])];
	const rows = animating([{ token: 1, item: thread('t2'), groupLabel: 'A', precededBy: 'thread:missing' }]);
	assert.deepEqual(ids(groupsWithAnimatingRows(latest, rows)), [['t1', 't2']]);
});

test('keeps an animating row visible in its own group when the group disappeared', () => {
	const latest = [group('A', [thread('t1')])];
	const rows = animating([{ token: 1, item: thread('t2'), groupLabel: 'B', precededBy: null }]);
	const result = groupsWithAnimatingRows(latest, rows);
	assert.deepEqual(result.map(function(g) { return g.label; }), ['A', 'B']);
	assert.deepEqual(ids(result), [['t1'], ['t2']]);
});

test('does not duplicate an animating row that reappeared in the latest groups', () => {
	const latest = [group('A', [thread('t1'), thread('t2')])];
	const rows = animating([{ token: 1, item: thread('t2'), groupLabel: 'A', precededBy: itemKey(thread('t1')) }]);
	assert.deepEqual(ids(groupsWithAnimatingRows(latest, rows)), [['t1', 't2']]);
});

test('does not modify the latest groups', () => {
	const latest = [group('A', [thread('t1')])];
	const rows = animating([{ token: 1, item: thread('t2'), groupLabel: 'A', precededBy: itemKey(thread('t1')) }]);
	groupsWithAnimatingRows(latest, rows);
	assert.deepEqual(ids(latest), [['t1']]);
});

test('goneItems reports threads missing from the latest groups with their old position', () => {
	const previous = [group('A', [thread('t1'), thread('t2')])];
	const latest = [group('A', [thread('t1')])];
	const gone = goneItems(previous, latest);
	assert.equal(gone.length, 1);
	assert.equal(gone[0].item.threadId, 't2');
	assert.equal(gone[0].groupLabel, 'A');
	assert.equal(gone[0].precededBy, itemKey(thread('t1')));
});

test('goneItems does not report a bundle that shrank, dissolved or whose threads moved', () => {
	const previous = [group('A', [bundle('b1', ['t1', 't2', 't3']), bundle('b2', ['t4', 't5'])])];
	const latest = [group('A', [bundle('b1', ['t1', 't2']), thread('t4')])];
	assert.deepEqual(goneItems(previous, latest), []);
});

test('goneItems reports a bundle when neither it nor its members remain', () => {
	const previous = [group('A', [bundle('b1', ['t1', 't2']), thread('t3')])];
	const latest = [group('A', [thread('t3')])];
	const gone = goneItems(previous, latest);
	assert.deepEqual(gone.map(function(row) { return itemKey(row.item); }), ['bundle:b1']);
});
