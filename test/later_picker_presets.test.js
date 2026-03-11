import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHideUntilPreset } from '../src/frontend/later_picker_presets.js';

test('resolveHideUntilPreset returns three hours from now for hours preset', () => {
	const now = new Date('2026-03-10T12:15:00');

	assert.deepEqual(resolveHideUntilPreset('hours', now), {
		type: 'timestamp',
		value: new Date('2026-03-10T15:15:00').getTime(),
	});
});

test('resolveHideUntilPreset returns same-day evening when there is time left', () => {
	const now = new Date('2026-03-10T12:15:00');

	assert.deepEqual(resolveHideUntilPreset('evening', now), {
		type: 'timestamp',
		value: new Date('2026-03-10T18:00:00').getTime(),
	});
});

test('resolveHideUntilPreset returns next-day evening when tonight is too close', () => {
	const now = new Date('2026-03-10T16:15:00');

	assert.deepEqual(resolveHideUntilPreset('evening', now), {
		type: 'timestamp',
		value: new Date('2026-03-11T18:00:00').getTime(),
	});
});

test('resolveHideUntilPreset returns next Saturday morning for weekend preset', () => {
	const now = new Date('2026-03-10T12:15:00');

	assert.deepEqual(resolveHideUntilPreset('weekend', now), {
		type: 'timestamp',
		value: new Date('2026-03-14T07:00:00').getTime(),
	});
});

test('resolveHideUntilPreset returns the following Monday when current Monday morning already passed', () => {
	const now = new Date('2026-03-09T08:30:00');

	assert.deepEqual(resolveHideUntilPreset('monday', now), {
		type: 'timestamp',
		value: new Date('2026-03-16T07:00:00').getTime(),
	});
});

test('resolveHideUntilPreset preserves month-based presets and special values', () => {
	const now = new Date('2026-03-10T12:15:00');

	assert.deepEqual(resolveHideUntilPreset('month', now), {
		type: 'timestamp',
		value: new Date('2026-04-10T07:00:00').getTime(),
	});
	assert.deepEqual(resolveHideUntilPreset('someday', now), {
		type: 'timestamp',
		value: new Date('2026-09-10T07:00:00').getTime(),
	});
	assert.deepEqual(resolveHideUntilPreset('when-i-have-time', now), {
		type: 'when-i-have-time',
	});
	assert.equal(resolveHideUntilPreset('custom', now), null);
	assert.equal(resolveHideUntilPreset('missing', now), null);
});
