import test from 'node:test';
import assert from 'node:assert/strict';

import {
	formatFileSize,
	formatPrettyTimestamp,
	humanizeDuration,
} from '../src/frontend/display_format.js';

// Wednesday, 2026-10-14 at 15:30 local time.
const NOW = new Date(2026, 9, 14, 15, 30);

test('formatPrettyTimestamp shows only the time for today', () => {
	assert.equal(formatPrettyTimestamp(new Date(2026, 9, 14, 9, 5).getTime(), NOW), '9:05 AM');
	assert.equal(formatPrettyTimestamp(new Date(2026, 9, 14, 0, 0).getTime(), NOW), '12:00 AM');
	assert.equal(formatPrettyTimestamp(new Date(2026, 9, 14, 12, 45).getTime(), NOW), '12:45 PM');
});

test('formatPrettyTimestamp shows the weekday and time earlier in the same Sunday-started week', () => {
	assert.equal(formatPrettyTimestamp(new Date(2026, 9, 11, 21, 15).getTime(), NOW), 'Sun 9:15 PM');
});

test('formatPrettyTimestamp shows the month and ordinal day earlier in the year', () => {
	assert.equal(formatPrettyTimestamp(new Date(2026, 9, 10, 8, 0).getTime(), NOW), 'Oct 10th');
	assert.equal(formatPrettyTimestamp(new Date(2026, 0, 1).getTime(), NOW), 'Jan 1st');
	assert.equal(formatPrettyTimestamp(new Date(2026, 1, 22).getTime(), NOW), 'Feb 22nd');
	assert.equal(formatPrettyTimestamp(new Date(2026, 2, 13).getTime(), NOW), 'Mar 13th');
});

test('formatPrettyTimestamp shows the full date for other years', () => {
	assert.equal(formatPrettyTimestamp(new Date(2025, 4, 3).getTime(), NOW), '2025-May-03');
});

test('formatPrettyTimestamp of an invalid timestamp is empty', () => {
	assert.equal(formatPrettyTimestamp(Number.NaN, NOW), '');
});

test('humanizeDuration describes read times approximately', () => {
	assert.equal(humanizeDuration(0), 'a few seconds');
	assert.equal(humanizeDuration(60), 'a minute');
	assert.equal(humanizeDuration(150), '3 minutes');
	assert.equal(humanizeDuration(3600), 'an hour');
	assert.equal(humanizeDuration(3 * 3600), '3 hours');
	assert.equal(humanizeDuration(24 * 3600), 'a day');
	assert.equal(humanizeDuration(4 * 86400), '4 days');
});

test('formatFileSize uses binary units rounded to two decimals', () => {
	assert.equal(formatFileSize(0), '0 B');
	assert.equal(formatFileSize(512), '512 B');
	assert.equal(formatFileSize(1024), '1 KB');
	assert.equal(formatFileSize(260734), '254.62 KB');
	assert.equal(formatFileSize(1.5 * 1024 * 1024), '1.5 MB');
	assert.equal(formatFileSize(1024 * 1024 - 1), '1 MB');
});
