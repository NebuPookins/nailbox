import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createThreadActionController,
	filterSelectableLabels,
} from '../src/frontend/thread_action_controller.js';

function createMessengerGetter() {
	const events = [];
	return {
		events,
		messengerGetter() {
			return {
				error(message) {
					events.push({
						type: 'error',
						message,
					});
				},
				info(message) {
					events.push({
						type: 'info',
						message,
					});
					return {
						update(payload) {
							events.push(payload);
						},
					};
				},
			};
		},
	};
}

test('filterSelectableLabels removes hidden and reserved labels', () => {
	const labels = [
		{ id: 'Label_1', labelListVisibility: 'labelShow' },
		{ id: 'UNREAD', labelListVisibility: 'labelShow' },
		{ id: 'SENT', labelListVisibility: 'labelShow' },
		{ id: 'CUSTOM_HIDDEN', labelListVisibility: 'labelHide' },
	];

	assert.deepEqual(filterSelectableLabels(labels), [
		{ id: 'Label_1', labelListVisibility: 'labelShow' },
	]);
});

test('deleteThread removes the thread from the UI after the API call succeeds', async () => {
	const removedThreadIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const appApi = {
		async deleteThread(threadId) {
			assert.equal(threadId, 'abc123');
		},
	};
	const controller = createThreadActionController({
		appApi,
		messengerGetter,
		onThreadRemoved(threadId) {
			removedThreadIds.push(threadId);
		},
	});

	const result = await controller.deleteThread('abc123');

	assert.deepEqual(result, { ok: true });
	assert.deepEqual(removedThreadIds, ['abc123']);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Deleting thread abc123...' },
		{ type: 'success', message: 'Successfully deleted message abc123' },
	]);
});

test('archiveThread reports a missing thread id without calling the API', async () => {
	const { events, messengerGetter } = createMessengerGetter();
	let archiveCalled = false;
	const controller = createThreadActionController({
		appApi: {
			async archiveThread() {
				archiveCalled = true;
			},
		},
		messengerGetter,
	});

	const result = await controller.archiveThread('');

	assert.equal(archiveCalled, false);
	assert.deepEqual(result, {
		ok: false,
		reason: 'missing-thread-id',
	});
	assert.deepEqual(events, [
		{ type: 'info', message: 'Archiving thread ...' },
		{ type: 'error', message: 'Missing thread id.' },
	]);
});

test('moveThreadToLabel updates Gmail then removes the thread from the current list', async () => {
	const removedThreadIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const appApi = {
		async moveThreadToLabel(threadId, labelId) {
			assert.equal(threadId, 'abc123');
			assert.equal(labelId, 'Label_2');
		},
	};
	const controller = createThreadActionController({
		appApi,
		messengerGetter,
		onThreadRemoved(threadId) {
			removedThreadIds.push(threadId);
		},
	});

	const result = await controller.moveThreadToLabel('abc123', 'Label_2');

	assert.deepEqual(result, { ok: true });
	assert.deepEqual(removedThreadIds, ['abc123']);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Moving thread abc123 to label...' },
		{ type: 'success', message: 'Successfully moved thread abc123 to label.' },
	]);
});

test('openLabelPicker stores thread context before showing the modal', () => {
	const calls = [];
	const controller = createThreadActionController({
		appApi: {},
		messengerGetter: createMessengerGetter().messengerGetter,
	});

	const returnValue = controller.openLabelPicker({
		threadId: 'abc123',
		subject: 'Subject line',
		setThreadId(threadId) {
			calls.push(['threadId', threadId]);
		},
		setTitle(subject) {
			calls.push(['title', subject]);
		},
		show() {
			calls.push(['show']);
		},
	});

	assert.equal(returnValue, false);
	assert.deepEqual(calls, [
		['title', 'Subject line'],
		['threadId', 'abc123'],
		['show'],
	]);
});
