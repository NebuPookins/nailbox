import test from 'node:test';
import assert from 'node:assert/strict';

import {countWords, htmlToPlainText, sanitizeEmailHtml} from '../src/server/services/email_html.js';

const cidUrl = (contentId) => `/cid/${encodeURIComponent(contentId)}`;
const sanitize = (html) => sanitizeEmailHtml(html, {cidUrl});

test('sanitizeEmailHtml keeps style blocks, style attributes and classes', () => {
	const result = sanitize('<html><head><style>.a { color: red }</style></head><body><p class="a" style="margin:0">Hi</p></body></html>');
	assert.match(result, /<style>\.a \{ color: red \}<\/style>/);
	assert.match(result, /<p class="a" style="margin:0">Hi<\/p>/);
});

test('sanitizeEmailHtml keeps layout markup commonly used in emails', () => {
	const result = sanitize('<table width="600" bgcolor="#fff" cellpadding="0"><tr><td colspan="2" valign="top"><font color="red">x</font></td></tr></table><center>c</center>');
	assert.match(result, /<table width="600" bgcolor="#fff" cellpadding="0">/);
	assert.match(result, /<td colspan="2" valign="top">/);
	assert.match(result, /<font color="red">/);
	assert.match(result, /<center>c<\/center>/);
});

test('sanitizeEmailHtml strips scripts, event handlers, embeds and forms', () => {
	const result = sanitize([
		'<script>alert(1)</script>',
		'<p onclick="evil()" onmouseover="evil()">text</p>',
		'<iframe src="https://evil.example"></iframe>',
		'<object data="x"></object><embed src="x">',
		'<form action="https://evil.example"><input name="a"><button>go</button><select><option>o</option></select><textarea>t</textarea></form>',
		'<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/a.css">',
		'<svg><script>alert(1)</script></svg>',
	].join(''));
	assert.doesNotMatch(result, /<script|alert|onclick|onmouseover|<iframe|<object|<embed|<form|<input|<button|<select|<textarea|<meta|<base|<link/i);
	assert.match(result, /text/);
});

test('sanitizeEmailHtml restricts link and image URL schemes', () => {
	const result = sanitize([
		'<a href="javascript:alert(1)">bad</a>',
		'<a href="https://example.com">web</a>',
		'<a href="mailto:a@example.com">mail</a>',
		'<a href="tel:+123">tel</a>',
		'<a href="data:text/html,x">data</a>',
		'<img src="javascript:alert(1)">',
		'<img src="data:image/png;base64,AAAA">',
		'<img src="https://example.com/a.png">',
	].join(''));
	assert.doesNotMatch(result, /javascript:/);
	assert.doesNotMatch(result, /href="data:/);
	assert.match(result, /href="https:\/\/example\.com"/);
	assert.match(result, /href="mailto:a@example\.com"/);
	assert.match(result, /href="tel:\+123"/);
	assert.match(result, /src="data:image\/png;base64,AAAA"/);
	assert.match(result, /src="https:\/\/example\.com\/a\.png"/);
});

test('sanitizeEmailHtml makes links open in a new context without an opener', () => {
	const result = sanitize('<a href="https://example.com">x</a>');
	assert.match(result, /target="_blank"/);
	assert.match(result, /rel="noopener noreferrer"/);
});

test('sanitizeEmailHtml rewrites cid references via cidUrl', () => {
	const result = sanitize([
		'<img src="cid:logo@example.com">',
		'<img src="CID:Other" srcset="cid:logo@example.com 1x, https://example.com/b.png 2x">',
		'<table background="cid:bg"><tr><td>x</td></tr></table>',
	].join(''));
	assert.match(result, /src="\/cid\/logo%40example\.com"/);
	assert.match(result, /src="\/cid\/Other"/);
	assert.match(result, /srcset="\/cid\/logo%40example\.com 1x, https:\/\/example\.com\/b\.png 2x"/);
	assert.match(result, /background="\/cid\/bg"/);
	assert.doesNotMatch(result, /cid:/i);
});

test('sanitizeEmailHtml decodes URL-encoded cid references to their Content-ID', () => {
	const contentIds = [];
	sanitizeEmailHtml('<img src="cid:logo%40example.com"><img src="cid:100%">', {
		cidUrl: (contentId) => {
			contentIds.push(contentId);
			return '/x';
		},
	});
	assert.deepEqual(contentIds, ['logo@example.com', '100%']);
});

test('sanitizeEmailHtml rewrites cid backgrounds on any element, including in inline styles', () => {
	const result = sanitize([
		'<body background="cid:page"><div style="background-image: url(\'cid:hero\'); color: red">x</div>',
		'<tr background="cid:row"><td style="background:url(cid:cell)">y</td></tr></body>',
	].join(''));
	assert.match(result, /background="\/cid\/page"/);
	assert.match(result, /background="\/cid\/row"/);
	assert.match(result, /url\('\/cid\/hero'\)/);
	assert.match(result, /url\(\/cid\/cell\)/);
	assert.doesNotMatch(result, /cid:/i);
});

test('htmlToPlainText separates paragraphs and line breaks', () => {
	const text = htmlToPlainText('<p>First paragraph</p><p>Second<br>line two</p><ul><li>one</li><li>two</li></ul>');
	assert.equal(text, 'First paragraph\n\nSecond\nline two\n\none\ntwo');
});

test('htmlToPlainText ignores styles and scripts, decodes entities and collapses blank lines', () => {
	const text = htmlToPlainText('<html><head><title>T</title><style>p{color:red}</style></head><body><script>x()</script><div>a &amp; b &lt;c&gt;</div><div></div><div></div><div>d</div></body></html>');
	assert.equal(text, 'a & b <c>\n\nd');
});

test('htmlToPlainText collapses source whitespace within a paragraph', () => {
	assert.equal(htmlToPlainText('<p>one\n   two\t three</p>'), 'one two three');
});

test('countWords splits on any whitespace', () => {
	assert.equal(countWords('one  two\nthree\tfour'), 4);
	assert.equal(countWords('  \n '), 0);
});
