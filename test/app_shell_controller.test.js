import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppShellController } from '../src/frontend/app_shell_controller.js';

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
				return { ok: true, value: authStatus };
			},
		},
		getAuthStatus: () => ({ ok: true, value: authStatus }),
		loadGroupingRules: () => { throw new Error('unused'); },
		loadLabels: () => { throw new Error('unused'); },
		messengerGetter: createMessengerGetter().messengerGetter,
		renderConnectedState: () => { renders.push('connected'); },
		renderDisconnectedState: () => { renders.push('disconnected'); },
		renderSetupNeededState: () => { renders.push('setup'); },
		setAuthStatus: (value) => { authStatus = value; },
		syncThreadsFromGoogle: () => { throw new Error('unused'); },
		threadUpdatesConnection: undefined,
		updateUiWithThreadsFromServer: () => { throw new Error('unused'); },
	});

	const result = await controller.initialize();

	assert.deepEqual(result, { ok: true, value: 'setup-needed' });
	assert.deepEqual(renders, ['setup']);
});

test('initialize bootstraps a connected session and opens thread updates connection', async () => {
	let authStatus = {
		configured: true,
		connected: true,
		emailAddress: 'me@example.com',
	};
	const calls = [];
	const { events, messengerGetter } = createMessengerGetter();
	const threadUpdatesConnection = {
		connect() {
			calls.push('connectThreadUpdates');
		},
		disconnect() {
			calls.push('disconnectThreadUpdates');
		},
	};
	const controller = createAppShellController({
		appApi: {
			async loadAuthStatus() {
				calls.push('loadAuthStatus');
				return { ok: true, value: authStatus };
			},
		},
		getAuthStatus: () => ({ ok: true, value: authStatus }),
		loadGroupingRules: async () => { calls.push('loadGroupingRules'); },
		loadLabels: async () => { calls.push('loadLabels'); return { ok: true, value: undefined }; },
		messengerGetter,
		renderConnectedState: () => { calls.push('renderConnectedState'); },
		renderDisconnectedState: () => { calls.push('renderDisconnectedState'); },
		renderSetupNeededState: () => { calls.push('renderSetupNeededState'); },
		setAuthStatus: (value) => { authStatus = value; },
		syncThreadsFromGoogle: async (messenger) => { calls.push(['syncThreadsFromGoogle', Boolean(messenger)]); },
		threadUpdatesConnection,
		updateUiWithThreadsFromServer: async (messenger) => { calls.push(['updateUiWithThreadsFromServer', Boolean(messenger)]); },
	});

	const result = await controller.initialize();

	assert.deepEqual(result, { ok: true, value: 'connected' });
	assert.deepEqual(calls, [
		'loadAuthStatus',
		'renderConnectedState',
		'loadGroupingRules',
		['updateUiWithThreadsFromServer', true],
		'loadLabels',
		'connectThreadUpdates',
	]);
	assert.deepEqual(events, [
		{ type: 'info', message: 'Loading cached threads...' },
	]);
});

test('initialize returns error result when loadAuthStatus fails', async () => {
	const renders = [];
	const controller = createAppShellController({
		appApi: {
			async loadAuthStatus() {
				return { ok: false, error: new Error('Network error') };
			},
		},
		getAuthStatus: () => ({ configured: false, connected: false }),
		loadGroupingRules: () => { throw new Error('unused'); },
		loadLabels: () => { throw new Error('unused'); },
		messengerGetter: createMessengerGetter().messengerGetter,
		renderConnectedState: () => { renders.push('connected'); },
		renderDisconnectedState: () => { renders.push('disconnected'); },
		renderSetupNeededState: (message) => { renders.push(message || 'setup'); },
		setAuthStatus: () => {},
		syncThreadsFromGoogle: () => { throw new Error('unused'); },
		threadUpdatesConnection: undefined,
		updateUiWithThreadsFromServer: () => { throw new Error('unused'); },
	});

	const result = await controller.initialize();

	assert.deepEqual(result, { ok: false, error: new Error('Network error') });
	assert.deepEqual(renders, ['Failed to load authentication status. Please check your connection and try again.']);
});

test('disconnectGmail clears the local auth session and renders the disconnected state', async () => {
	let authStatus = {
		configured: true,
		connected: true,
		emailAddress: 'me@example.com',
	};
	const renders = [];
	const threadUpdatesConnection = {
		connect() {
			renders.push('connectThreadUpdates');
		},
		disconnect() {
			renders.push('disconnectThreadUpdates');
		},
	};
	const controller = createAppShellController({
		appApi: {
			async disconnectGmail() {
				renders.push('disconnectRequest');
			},
		},
		getAuthStatus: () => ({ ok: true, value: authStatus }),
		loadGroupingRules: () => { throw new Error('unused'); },
		loadLabels: () => { throw new Error('unused'); },
		messengerGetter: createMessengerGetter().messengerGetter,
		renderConnectedState: () => {},
		renderDisconnectedState: (message) => { renders.push(message); },
		renderSetupNeededState: () => {},
		setAuthStatus: (value) => { authStatus = value; },
		syncThreadsFromGoogle: () => { throw new Error('unused'); },
		threadUpdatesConnection,
		updateUiWithThreadsFromServer: () => { throw new Error('unused'); },
	});

	const result = await controller.disconnectGmail();

	assert.deepEqual(result, { ok: true });
	assert.equal(authStatus.connected, false);
	assert.equal(authStatus.emailAddress, null);
	assert.deepEqual(renders, ['disconnectRequest', 'disconnectThreadUpdates', 'Gmail disconnected.']);
});
