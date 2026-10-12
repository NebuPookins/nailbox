import test from 'node:test';
import assert from 'node:assert/strict';

import { renderIndexPage } from '../src/server/views/index_page.js';
import { renderProfilePage } from '../src/server/views/profile_page.js';
import { renderSetupPage } from '../src/server/views/setup_page.js';

const disconnected = {configured: true, connected: false, emailAddress: null, scopes: []};
const connected = {configured: true, connected: true, emailAddress: 'me@example.com', scopes: []};

function setupViewModel(overrides = {}) {
	return {
		googleOAuth: {clientId: 'client-id', clientSecret: 'secret'},
		authStatus: disconnected,
		defaultRedirectUri: 'http://localhost:3000/auth/google/callback',
		...overrides,
	};
}

test('renderIndexPage is an HTML document that loads the client bundle and its mount points', () => {
	const html = renderIndexPage('/public/assets/main-ABC.js');

	assert.match(html, /^<!DOCTYPE html>/);
	assert.match(html, /<script src="\/public\/assets\/main-ABC\.js"><\/script>/);
	for (const id of ['thread-list-root', 'thread-viewer', 'later-picker', 'label-picker', 'settings-modal', 'sender-rule-root']) {
		assert.match(html, new RegExp(`id="${id}"`));
	}
});

test('renderSetupPage fills in the saved OAuth settings, defaulting the redirect URI', () => {
	const html = renderSetupPage(setupViewModel());

	assert.match(html, /name="clientId"[^>]*value="client-id"/);
	assert.match(html, /name="redirectUri"[^>]*value="http:\/\/localhost:3000\/auth\/google\/callback"/);
	assert.match(html, /Gmail is not connected yet\./);
	assert.match(html, />Connect Gmail</);
});

test('renderSetupPage shows the connected account and escapes notices', () => {
	const html = renderSetupPage(setupViewModel({
		authStatus: connected,
		notice: {kind: 'error', text: 'Bad <input>'},
	}));

	assert.match(html, /me@example\.com/);
	assert.match(html, />Reconnect Gmail</);
	assert.match(html, /class="alert alert-danger" role="alert">Bad &lt;input&gt;</);
});

test('renderProfilePage selects the saved model and never echoes the saved API key', () => {
	const html = renderProfilePage({
		...setupViewModel({notice: {kind: 'success', text: 'Profile settings saved.'}}),
		anthropic: {apiKey: 'sk-ant-secret', model: 'claude-opus-5-5'},
	});

	assert.match(html, /<option value="claude-opus-5-5" selected="">/);
	assert.doesNotMatch(html, /sk-ant-secret/);
	assert.match(html, /Saved key \(leave blank to keep it\)/);
	assert.match(html, /alert-success[^>]*>Profile settings saved\.</);
});
