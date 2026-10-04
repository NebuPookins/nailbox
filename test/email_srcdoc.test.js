import test from 'node:test';
import assert from 'node:assert/strict';

import {
	EMAIL_FRAME_SANDBOX,
	buildEmailSrcdoc,
	buildReaderSrcdoc,
	mayReferenceRemoteContent,
} from '../src/frontend/email_srcdoc.js';

const ORIGIN = 'http://localhost:3000';
/** A bare scheme source, which would let any web URL load. */
const ANY_WEB_SCHEME = /(?:^|\s)https?:(?:\s|$)/;

function cspOf(srcdoc) {
	const match = srcdoc.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
	assert.ok(match, 'document should declare a CSP');
	return match[1];
}

function directive(csp, name) {
	return csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + ' '));
}

test('email srcdoc blocks remote images and fonts by default', () => {
	const csp = cspOf(buildEmailSrcdoc({html: '<p>x</p>', remoteContent: 'blocked', origin: ORIGIN}));
	assert.doesNotMatch(directive(csp, 'img-src'), ANY_WEB_SCHEME);
	assert.doesNotMatch(directive(csp, 'font-src'), ANY_WEB_SCHEME);
	assert.match(directive(csp, 'img-src'), /data:/);
});

test('email srcdoc lets inline images load from our own server, but not other endpoints of it', () => {
	const imgSrc = directive(cspOf(buildEmailSrcdoc({html: '<p>x</p>', remoteContent: 'blocked', origin: ORIGIN})), 'img-src');
	assert.match(imgSrc, /http:\/\/localhost:3000\/api\/threads\//);
	assert.doesNotMatch(imgSrc, /'self'/);
});

test('email srcdoc allows remote images and fonts when asked', () => {
	const csp = cspOf(buildEmailSrcdoc({html: '<p>x</p>', remoteContent: 'allowed', origin: ORIGIN}));
	assert.match(directive(csp, 'img-src'), ANY_WEB_SCHEME);
	assert.match(directive(csp, 'font-src'), ANY_WEB_SCHEME);
	assert.match(directive(csp, 'style-src'), ANY_WEB_SCHEME);
});

test('email srcdoc keeps remote stylesheets blocked by default', () => {
	const csp = cspOf(buildEmailSrcdoc({html: '<p>x</p>', remoteContent: 'blocked', origin: ORIGIN}));
	assert.doesNotMatch(directive(csp, 'style-src'), ANY_WEB_SCHEME);
});

test('email srcdoc forbids everything not explicitly allowed, including scripts', () => {
	for (const remoteContent of ['blocked', 'allowed']) {
		const csp = cspOf(buildEmailSrcdoc({html: '<p>x</p>', remoteContent, origin: ORIGIN}));
		assert.match(csp, /default-src 'none'/);
		assert.doesNotMatch(csp, /script-src/);
	}
});

test('email srcdoc adds no script of its own and makes links open in new tabs', () => {
	for (const build of [buildEmailSrcdoc, buildReaderSrcdoc]) {
		const srcdoc = build({html: '<p>x</p>', remoteContent: 'blocked', origin: ORIGIN});
		assert.doesNotMatch(srcdoc, /<script/i);
		assert.match(srcdoc, /<base target="_blank">/);
	}
});

test('email srcdoc puts the base stylesheet before the email content so the email can override it', () => {
	const srcdoc = buildEmailSrcdoc({html: '<style>body{margin:0}</style><p>hello</p>', remoteContent: 'blocked', origin: ORIGIN});
	assert.ok(srcdoc.indexOf('overflow-wrap:anywhere') < srcdoc.indexOf('body{margin:0}'));
	assert.match(srcdoc, /img\{max-width:100%; height:auto\}/);
	assert.doesNotMatch(srcdoc, /zoom/);
});

test('email srcdoc contains the given html', () => {
	assert.match(buildEmailSrcdoc({html: '<p>hello</p>', remoteContent: 'blocked', origin: ORIGIN}), /<p>hello<\/p>/);
	assert.match(buildReaderSrcdoc({html: '<p>hello</p>', remoteContent: 'blocked', origin: ORIGIN}), /<p>hello<\/p>/);
});

test('reader srcdoc limits the line length for readability', () => {
	assert.match(buildReaderSrcdoc({html: '<p>x</p>', remoteContent: 'blocked', origin: ORIGIN}), /max-width:40em/);
});

test('frame sandbox never grants script execution', () => {
	assert.doesNotMatch(EMAIL_FRAME_SANDBOX, /allow-scripts/);
	assert.match(EMAIL_FRAME_SANDBOX, /allow-same-origin/);
	assert.match(EMAIL_FRAME_SANDBOX, /allow-popups/);
});

test('mayReferenceRemoteContent detects remote images, backgrounds and CSS urls', () => {
	assert.equal(mayReferenceRemoteContent('<img src="https://x.example/a.png">'), true);
	assert.equal(mayReferenceRemoteContent('<img src="//x.example/a.png">'), true);
	assert.equal(mayReferenceRemoteContent('<td background="http://x.example/a.png">'), true);
	assert.equal(mayReferenceRemoteContent('<div style="background:url(https://x.example/a.png)">'), true);
	assert.equal(mayReferenceRemoteContent('<style>@import url(x.css)</style>'), true);
	assert.equal(mayReferenceRemoteContent('<body background="https://x.example/a.png">'), true);
});

test('mayReferenceRemoteContent ignores local images and plain links', () => {
	assert.equal(mayReferenceRemoteContent('<img src="/api/threads/t/messages/m/cid/a">'), false);
	assert.equal(mayReferenceRemoteContent('<img src="data:image/png;base64,AAAA">'), false);
	assert.equal(mayReferenceRemoteContent('<a href="https://x.example">link</a>'), false);
});
