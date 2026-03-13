import test from 'node:test';
import assert from 'node:assert/strict';

import { createThreadListController } from '../src/frontend/thread_list_controller.js';

test('deleteThread delegates to the thread action controller', async () => {
	const calls = [];
	const controller = createThreadListController({
		openLabelPicker() {
			throw new Error('unused');
		},
		openLaterPicker() {
			throw new Error('unused');
		},
		openThreadViewer() {
			throw new Error('unused');
		},
		reportError(error) {
			calls.push(['error', error.message]);
		},
		threadActionController: {
			async deleteThread(threadId) {
				calls.push(['delete', threadId]);
			},
		},
		threadViewerController: {
			async openThread() {
				throw new Error('unused');
			},
		},
	});

	const result = await controller.deleteThread('thread-1');

	assert.equal(result, false);
	assert.deepEqual(calls, [['delete', 'thread-1']]);
});

test('openLaterPicker forwards thread id and subject', () => {
	const calls = [];
	const controller = createThreadListController({
		openLabelPicker() {
			throw new Error('unused');
		},
		openLaterPicker(threadId, subject) {
			calls.push([threadId, subject]);
			return false;
		},
		openThreadViewer() {
			throw new Error('unused');
		},
		reportError() {},
		threadActionController: {},
		threadViewerController: {},
	});

	const result = controller.openLaterPicker({
		threadId: 'thread-1',
		subject: 'Subject line',
	});

	assert.equal(result, false);
	assert.deepEqual(calls, [['thread-1', 'Subject line']]);
});

test('openThread builds viewer options before delegating to the viewer controller', async () => {
	const calls = [];
	const controller = createThreadListController({
		openLabelPicker() {
			throw new Error('unused');
		},
		openLaterPicker() {
			throw new Error('unused');
		},
		openThreadViewer(threadSummary) {
			calls.push(['build', threadSummary.threadId]);
			return {
				threadId: threadSummary.threadId,
			};
		},
		reportError() {},
		threadActionController: {},
		threadViewerController: {
			async openThread(payload) {
				calls.push(['open', payload.threadId]);
			},
		},
	});

	await controller.openThread({
		threadId: 'thread-1',
	});

	assert.deepEqual(calls, [
		['build', 'thread-1'],
		['open', 'thread-1'],
	]);
});
