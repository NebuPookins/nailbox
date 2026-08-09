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
			return { ok: true, value: null };
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
			return { ok: true, value: null };
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

test('markThreadAsSpam removes the thread from the UI after the API call succeeds', async () => {
	const removedThreadIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const appApi = {
		async markThreadAsSpam(threadId) {
			assert.equal(threadId, 'abc123');
			return { ok: true, value: null };
		},
	};
	const controller = createThreadActionController({
		appApi,
		messengerGetter,
		onThreadRemoved(threadId) {
			removedThreadIds.push(threadId);
		},
	});

	const result = await controller.markThreadAsSpam('abc123');

	assert.deepEqual(result, { ok: true });
	assert.deepEqual(removedThreadIds, ['abc123']);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Reporting thread abc123 as spam...' },
		{ type: 'success', message: 'Successfully reported thread abc123 as spam.' },
	]);
});

test('markThreadAsSpam reports a missing thread id without calling the API', async () => {
	const { events, messengerGetter } = createMessengerGetter();
	let markSpamCalled = false;
	const controller = createThreadActionController({
		appApi: {
			async markThreadAsSpam() {
				markSpamCalled = true;
			},
		},
		messengerGetter,
	});

	const result = await controller.markThreadAsSpam('');

	assert.equal(markSpamCalled, false);
	assert.deepEqual(result, { ok: false, reason: 'missing-thread-id' });
	assert.deepEqual(events, [
		{ type: 'info', message: 'Reporting thread  as spam...' },
		{ type: 'error', message: 'Missing thread id.' },
	]);
});

test('markThreadAsSpam keeps the thread in the UI and reports the error when the API call fails', async () => {
	const removedThreadIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createThreadActionController({
		appApi: {
			async markThreadAsSpam() {
				return { ok: false, error: new Error('Gmail said no.') };
			},
		},
		messengerGetter,
		onThreadRemoved(threadId) {
			removedThreadIds.push(threadId);
		},
	});

	const result = await controller.markThreadAsSpam('abc123');

	assert.deepEqual(result, { ok: false, reason: 'request-failed' });
	assert.deepEqual(removedThreadIds, []);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Reporting thread abc123 as spam...' },
		{ type: 'error', message: 'Gmail said no.' },
	]);
});

test('archiveThread keeps the thread in the UI and reports the error when the API call fails', async () => {
	const removedThreadIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createThreadActionController({
		appApi: {
			async archiveThread() {
				return { ok: false, error: new Error('Network unreachable.') };
			},
		},
		messengerGetter,
		onThreadRemoved(threadId) {
			removedThreadIds.push(threadId);
		},
	});

	const result = await controller.archiveThread('abc123');

	assert.deepEqual(result, { ok: false, reason: 'request-failed' });
	assert.deepEqual(removedThreadIds, []);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Archiving thread abc123...' },
		{ type: 'error', message: 'Network unreachable.' },
	]);
});

test('deleteThread falls back to a generic message when the error carries none', async () => {
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createThreadActionController({
		appApi: {
			async deleteThread() {
				return { ok: false, error: new Error('') };
			},
		},
		messengerGetter,
	});

	const result = await controller.deleteThread('abc123');

	assert.deepEqual(result, { ok: false, reason: 'request-failed' });
	assert.deepEqual(events, [
		{ type: 'info', message: 'Deleting thread abc123...' },
		{ type: 'error', message: 'The request failed.' },
	]);
});

test('archiveBundle keeps the bundle in the UI and reports the error when the API call fails', async () => {
	const removedBundleIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createThreadActionController({
		appApi: {
			async archiveBundle() {
				return { ok: false, error: new Error('Gmail rejected the batch.') };
			},
		},
		messengerGetter,
		onBundleRemoved(bundleId) {
			removedBundleIds.push(bundleId);
		},
	});

	const result = await controller.archiveBundle('bundle-1');

	assert.deepEqual(result, { ok: false, reason: 'request-failed' });
	assert.deepEqual(removedBundleIds, []);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Archiving bundle bundle-1...' },
		{ type: 'error', message: 'Gmail rejected the batch.' },
	]);
});

test('markThreadAsSpam reports a rejected request on the original messenger and keeps the thread', async () => {
	const removedThreadIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createThreadActionController({
		appApi: {
			async markThreadAsSpam() {
				throw new Error('Failed to fetch');
			},
		},
		messengerGetter,
		onThreadRemoved(threadId) {
			removedThreadIds.push(threadId);
		},
	});

	const result = await controller.markThreadAsSpam('abc123');

	assert.deepEqual(result, { ok: false, reason: 'request-failed' });
	assert.deepEqual(removedThreadIds, []);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Reporting thread abc123 as spam...' },
		{ type: 'error', message: 'Failed to fetch' },
	]);
});

test('archiveBundle reports a rejected request on the original messenger and keeps the bundle', async () => {
	const removedBundleIds = [];
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createThreadActionController({
		appApi: {
			async archiveBundle() {
				throw new Error('Failed to fetch');
			},
		},
		messengerGetter,
		onBundleRemoved(bundleId) {
			removedBundleIds.push(bundleId);
		},
	});

	const result = await controller.archiveBundle('bundle-1');

	assert.deepEqual(result, { ok: false, reason: 'request-failed' });
	assert.deepEqual(removedBundleIds, []);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Archiving bundle bundle-1...' },
		{ type: 'error', message: 'Failed to fetch' },
	]);
});

test('archiveThread describes a rejection that is not an Error', async () => {
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createThreadActionController({
		appApi: {
			async archiveThread() {
				throw 'connection reset';
			},
		},
		messengerGetter,
	});

	const result = await controller.archiveThread('abc123');

	assert.deepEqual(result, { ok: false, reason: 'request-failed' });
	assert.deepEqual(events, [
		{ type: 'info', message: 'Archiving thread abc123...' },
		{ type: 'error', message: 'connection reset' },
	]);
});
