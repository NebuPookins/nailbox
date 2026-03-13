import test from 'node:test';
import assert from 'node:assert/strict';

import {
	renderConnectedContent,
	renderDisconnectedContent,
	renderSetupNeededContent,
} from '../src/frontend/auth_status_presenter.js';

test('renderSetupNeededContent escapes the message and points to setup', () => {
	const content = renderSetupNeededContent('Need <oauth> & config');

	assert.match(content.statusHtml, /Need &lt;oauth&gt; &amp; config/);
	assert.match(content.statusHtml, /href="\/setup"/);
	assert.equal(content.authControlsHtml, '');
});

test('renderDisconnectedContent includes reconnect controls', () => {
	const content = renderDisconnectedContent();

	assert.match(content.statusHtml, /Connect Gmail/);
	assert.match(content.authControlsHtml, /auth\/google\/start/);
});

test('renderConnectedContent shows the connected email address', () => {
	const content = renderConnectedContent({
		emailAddress: 'me@example.com',
	});

	assert.match(content.statusHtml, /Loading Nailbox/);
	assert.match(content.authControlsHtml, /me@example\.com/);
	assert.match(content.authControlsHtml, /disconnect-gmail-btn/);
});

