import test from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_ENTRIES,
	addAnnouncement,
	currentAnnouncement,
	emptyLog,
	olderAnnouncements,
	updateAnnouncement,
} from '../src/frontend/announcement_log.js';

const info = (message) => ({ type: 'info', message });

test('an empty log has no current announcement', () => {
	assert.equal(currentAnnouncement(emptyLog()), null);
	assert.deepEqual(olderAnnouncements(emptyLog()), []);
});

test('the newest added announcement is current', () => {
	const first = addAnnouncement(emptyLog(), info('one'));
	const second = addAnnouncement(first.state, info('two'));
	assert.equal(currentAnnouncement(second.state)?.message, 'two');
	assert.deepEqual(olderAnnouncements(second.state).map(a => a.message), ['one']);
});

test('updating an older entry makes it current and keeps the others in history', () => {
	const a = addAnnouncement(emptyLog(), info('a'));
	const b = addAnnouncement(a.state, info('b'));
	const c = addAnnouncement(b.state, info('c'));
	const action = { label: 'Undo', onClick: () => {} };
	const updated = updateAnnouncement(c.state, a.id, { type: 'success', message: 'a done', action });
	const current = currentAnnouncement(updated);
	assert.equal(current?.message, 'a done');
	assert.equal(current?.type, 'success');
	assert.equal(current?.action, action);
	assert.deepEqual(olderAnnouncements(updated).map(x => x.message), ['c', 'b']);
});

test('updating an entry makes a new current entry object rather than reusing the old one', () => {
	const a = addAnnouncement(emptyLog(), info('a'));
	const before = currentAnnouncement(a.state);
	const after = currentAnnouncement(updateAnnouncement(a.state, a.id, { type: 'info', message: 'a', action: null }));
	assert.notEqual(after, before);
	assert.equal(after?.id, before?.id);
});

test('the history is capped and drops the oldest entries', () => {
	let state = emptyLog();
	for (let i = 0; i < MAX_ENTRIES + 5; i++) {
		state = addAnnouncement(state, info('m' + i)).state;
	}
	const all = [currentAnnouncement(state), ...olderAnnouncements(state)];
	assert.equal(all.length, MAX_ENTRIES);
	assert.equal(all[0]?.message, 'm' + (MAX_ENTRIES + 4));
	assert.equal(all[all.length - 1]?.message, 'm5');
});

test('updating a trimmed id changes nothing', () => {
	const first = addAnnouncement(emptyLog(), info('first'));
	let state = first.state;
	for (let i = 0; i < MAX_ENTRIES; i++) {
		state = addAnnouncement(state, info('m' + i)).state;
	}
	const after = updateAnnouncement(state, first.id, { type: 'error', message: 'late', action: null });
	assert.deepEqual(after, state);
});

test('olderAnnouncements excludes the current entry', () => {
	const a = addAnnouncement(emptyLog(), info('a'));
	assert.deepEqual(olderAnnouncements(a.state), []);
});
