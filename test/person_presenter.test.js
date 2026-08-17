import test from 'node:test';
import assert from 'node:assert/strict';

import { formatPerson } from '../src/frontend/person_presenter.js';

test('formatPerson shows the name and the email together', () => {
	assert.equal(
		formatPerson({ name: 'Jane Smith', email: 'jsmith@example.com' }),
		'Jane Smith (jsmith@example.com)'
	);
});

test('formatPerson falls back to the email when there is no name', () => {
	assert.equal(formatPerson({ name: '', email: 'noreply@example.com' }), 'noreply@example.com');
});

test('formatPerson falls back to the name when there is no email', () => {
	assert.equal(formatPerson({ name: 'Jane Smith' }), 'Jane Smith');
});

test('formatPerson returns an empty string when nothing is known', () => {
	assert.equal(formatPerson({ name: '' }), '');
	assert.equal(formatPerson(undefined), '');
});
