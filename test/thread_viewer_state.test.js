import test from 'node:test';
import assert from 'node:assert/strict';

import { createThreadViewerState } from '../src/frontend/thread_viewer_state.js';

test('thread viewer state tracks and clears thread context', () => {
	const state = createThreadViewerState();

	assert.equal(state.getThreadId(), null);
	assert.equal(state.getSubject(), '');

	state.setThreadId('thread-1');
	state.setSubject('Subject');

	assert.equal(state.getThreadId(), 'thread-1');
	assert.equal(state.getSubject(), 'Subject');

	state.clear();

	assert.equal(state.getThreadId(), null);
	assert.equal(state.getSubject(), '');
});
