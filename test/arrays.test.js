import test from 'node:test';
import assert from 'node:assert/strict';

import { maxBy, uniqBy } from '../helpers/arrays.js';

test('uniqBy keeps the first item for each key, in input order', () => {
	const people = [
		{name: 'Alfred', email: 'aa@example.com'},
		{name: 'Betty', email: 'bb@example.com'},
		{name: 'Alfie', email: 'aa@example.com'},
	];
	assert.deepEqual(uniqBy(people, (person) => person.email), [people[0], people[1]]);
});

test('uniqBy of an empty array is empty', () => {
	assert.deepEqual(uniqBy([], (item) => item), []);
});

test('maxBy returns the highest-scoring item, preferring the earliest on ties', () => {
	const items = [{id: 'a', size: 1}, {id: 'b', size: 3}, {id: 'c', size: 3}];
	assert.equal(maxBy(items, (item) => item.size), items[1]);
});

test('maxBy skips items whose score is NaN', () => {
	const items = [{id: 'a', size: Number.NaN}, {id: 'b', size: 2}];
	assert.equal(maxBy(items, (item) => item.size), items[1]);
	assert.equal(maxBy([{size: Number.NaN}], (item) => item.size), undefined);
});

test('maxBy of an empty array is undefined', () => {
	assert.equal(maxBy([], () => 0), undefined);
});
