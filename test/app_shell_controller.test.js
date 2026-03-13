import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppShellController } from '../src/frontend/app_shell_controller.js';

globalThis.moment = {
	duration(value, unit) {
		assert.equal(unit, 'minutes');
		return {
			as(targetUnit) {
				assert.equal(targetUnit, 'milliseconds');
				return value * 60000;
			},
		};
	},
};

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

test('initialize renders setup-needed state when OAuth is not configured', async () => {
	let authStatus = { configured: false, connected: false };
	const renders = [];
	const controller = createAppShellController({
		appApi: {
			async loadAuthStatus() {
				return authStatus;
			},
		},
		getAuthStatus() {
			return authStatus;
		},
		loadLabels() {
			throw new Error('unused');
		},
		messengerGetter: createMessengerGetter().messengerGetter,
		renderConnectedState() {
			renders.push('connected');
		},
		renderDisconnectedState() {
			renders.push('disconnected');
		},
		renderSetupNeededState() {
			renders.push('setup');
		},
		reportError() {},
		setAuthStatus(value) {
			authStatus = value;
		},
		syncThreadsFromGoogle() {
			throw new Error('unused');
		},
		updateUiWithThreadsFromServer() {
			throw new Error('unused');
		},
	});

	const result = await controller.initialize();

	assert.deepEqual(result, { ok: true, state: 'setup-needed' });
	assert.deepEqual(renders, ['setup']);
});

test('initialize bootstraps a connected session and schedules polling', async () => {
	let authStatus = {
		configured: true,
		connected: true,
		emailAddress: 'me@example.com',
	};
	const calls = [];
	const intervals = [];
	const { events, messengerGetter } = createMessengerGetter();
	const controller = createAppShellController({
		appApi: {
			async loadAuthStatus() {
				calls.push('loadAuthStatus');
				return authStatus;
			},
		},
		getAuthStatus() {
			return authStatus;
		},
		async loadLabels() {
			calls.push('loadLabels');
		},
		messengerGetter,
		renderConnectedState() {
			calls.push('renderConnectedState');
		},
		renderDisconnectedState() {
			calls.push('renderDisconnectedState');
		},
		renderSetupNeededState() {
			calls.push('renderSetupNeededState');
		},
		reportError(error) {
			calls.push(['reportError', error.message]);
		},
		scheduleInterval(callback, delay) {
			intervals.push({ callback, delay });
			return intervals.length;
		},
		setAuthStatus(value) {
			authStatus = value;
		},
		async syncThreadsFromGoogle(messenger) {
			calls.push(['syncThreadsFromGoogle', Boolean(messenger)]);
		},
		async updateUiWithThreadsFromServer(messenger) {
			calls.push(['updateUiWithThreadsFromServer', Boolean(messenger)]);
		},
	});

	const result = await controller.initialize();

	assert.deepEqual(result, { ok: true, state: 'connected' });
	assert.deepEqual(calls, [
		'loadAuthStatus',
		'renderConnectedState',
		['updateUiWithThreadsFromServer', true],
		'loadLabels',
		['syncThreadsFromGoogle', true],
		['updateUiWithThreadsFromServer', true],
	]);
	assert.deepEqual(intervals.map((item) => item.delay), [300000, 1800000]);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Loading cached threads...' },
		{ type: 'info', message: 'Downloading new threads from Gmail...' },
		{ type: 'info', message: 'Refreshing threads from cache...' },
	]);
});

test('disconnectGmail clears the local auth session and renders the disconnected state', async () => {
	let authStatus = {
		configured: true,
		connected: true,
		emailAddress: 'me@example.com',
	};
	const renders = [];
	const controller = createAppShellController({
		appApi: {
			async disconnectGmail() {
				renders.push('disconnectRequest');
			},
		},
		getAuthStatus() {
			return authStatus;
		},
		loadLabels() {
			throw new Error('unused');
		},
		messengerGetter: createMessengerGetter().messengerGetter,
		renderConnectedState() {},
		renderDisconnectedState(message) {
			renders.push(message);
		},
		renderSetupNeededState() {},
		reportError() {},
		setAuthStatus(value) {
			authStatus = value;
		},
		syncThreadsFromGoogle() {
			throw new Error('unused');
		},
		updateUiWithThreadsFromServer() {
			throw new Error('unused');
		},
	});

	const result = await controller.disconnectGmail();

	assert.deepEqual(result, { ok: true });
	assert.equal(authStatus.connected, false);
	assert.equal(authStatus.emailAddress, null);
	assert.deepEqual(renders, ['disconnectRequest', 'Gmail disconnected.']);
});

