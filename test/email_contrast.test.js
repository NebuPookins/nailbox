import test from 'node:test';
import assert from 'node:assert/strict';

import {
	CONTRAST_THRESHOLD,
	applyContrastFix,
	contrastRatio,
	ensureReadableContrast,
	isUnreadable,
	parseCssColor,
	relativeLuminance,
	removeContrastFix,
} from '../src/frontend/email_contrast.js';

/** A minimal DOM stand-in: only what the contrast check actually touches. */
class FakeElement {
	constructor(tag, styleValues = {}) {
		this.nodeType = 1;
		this.tagName = tag.toUpperCase();
		this.childNodes = [];
		this.parentElement = null;
		this.styleDecl = {
			color: 'rgb(0, 0, 0)',
			backgroundColor: 'rgba(0, 0, 0, 0)',
			backgroundImage: 'none',
			display: 'block',
			visibility: 'visible',
			...styleValues,
		};
		this.attributes = {};
	}
	get textContent() {
		return this.childNodes.map((child) => child.textContent ?? '').join('');
	}
	set textContent(value) {
		this.childNodes = [new FakeText(value)];
		this.childNodes[0].parentElement = this;
	}
	appendChild(child) {
		this.childNodes.push(child);
		child.parentElement = this;
		return child;
	}
	remove() {
		if (this.parentElement) {
			const index = this.parentElement.childNodes.indexOf(this);
			if (index >= 0) {
				this.parentElement.childNodes.splice(index, 1);
			}
		}
		this.parentElement = null;
	}
	setAttribute(name, value) {
		this.attributes[name] = value;
	}
	hasAttribute(name) {
		return name in this.attributes;
	}
}

class FakeText {
	constructor(text) {
		this.nodeType = 3;
		this.textContent = text;
		this.childNodes = [];
		this.parentElement = null;
	}
}

function fakeDocument(bodyStyle = {}, children = []) {
	const head = new FakeElement('head');
	const body = new FakeElement('body', bodyStyle);
	for (const child of children) {
		body.appendChild(child);
	}
	const documentElement = new FakeElement('html');
	const doc = {
		body,
		head,
		documentElement,
		defaultView: { getComputedStyle: (element) => element.styleDecl },
		listeners: {},
		addEventListener(type, listener, options) {
			(doc.listeners[type] ??= []).push({ listener, options });
		},
		removeEventListener(type, listener) {
			doc.listeners[type] = (doc.listeners[type] ?? []).filter((entry) => entry.listener !== listener);
		},
		createElement(tag) {
			return new FakeElement(tag);
		},
		querySelectorAll(selector) {
			const marker = 'data-email-contrast-fix';
			assert.ok(selector.includes(marker), 'test fake only supports the fix-marker selector');
			const found = [];
			const visit = (element) => {
				if (element.tagName === 'STYLE' && element.hasAttribute(marker)) {
					found.push(element);
				}
				for (const child of element.childNodes) {
					if (child.nodeType === 1) {
						visit(child);
					}
				}
			};
			visit(head);
			visit(body);
			return found;
		},
		fire(type) {
			for (const entry of doc.listeners[type] ?? []) {
				entry.listener();
			}
		},
	};
	return doc;
}

function paragraph(text, styleValues = {}) {
	const paragraph = new FakeElement('p', styleValues);
	paragraph.appendChild(new FakeText(text));
	return paragraph;
}

test('parseCssColor understands hex, rgb(), rgba() and named colors', () => {
	assert.deepEqual(parseCssColor('#fff'), { r: 255, g: 255, b: 255 });
	assert.deepEqual(parseCssColor('#1f2937'), { r: 31, g: 41, b: 55 });
	assert.deepEqual(parseCssColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30 });
	assert.deepEqual(parseCssColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30 });
	assert.deepEqual(parseCssColor('white'), { r: 255, g: 255, b: 255 });
	assert.deepEqual(parseCssColor('black'), { r: 0, g: 0, b: 0 });
});

test('parseCssColor rejects transparent colors and unknown values', () => {
	assert.equal(parseCssColor('transparent'), null);
	assert.equal(parseCssColor('rgba(0, 0, 0, 0)'), null);
	assert.equal(parseCssColor('hsl(0, 0%, 100%)'), null);
	assert.equal(parseCssColor('currentcolor'), null);
});

test('contrastRatio is 21 for black on white and 1 for identical colors', () => {
	const black = { r: 0, g: 0, b: 0 };
	const white = { r: 255, g: 255, b: 255 };
	assert.ok(Math.abs(contrastRatio(black, white) - 21) < 0.01);
	assert.equal(contrastRatio(black, black), 1);
	assert.ok(contrastRatio(white, { r: 240, g: 240, b: 240 }) < CONTRAST_THRESHOLD);
});

test('relativeLuminance is 0 for black and 1 for white', () => {
	assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
	assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
});

test('isUnreadable detects light text on a light background', () => {
	const doc = fakeDocument({}, [
		paragraph('This text is nearly invisible', { color: '#f0f0f0' }),
	]);
	assert.equal(isUnreadable(doc), true);
});

test('isUnreadable leaves dark text on a light background alone', () => {
	const doc = fakeDocument({}, [
		paragraph('Perfectly readable', { color: '#1f2937' }),
	]);
	assert.equal(isUnreadable(doc), false);
});

test('isUnreadable leaves light text on a dark background alone', () => {
	const doc = fakeDocument({ backgroundColor: '#111418' }, [
		paragraph('Dark-mode email', { color: '#e8eaed' }),
	]);
	assert.equal(isUnreadable(doc), false);
});

test('isUnreadable detects dark text on a dark background', () => {
	const doc = fakeDocument({ backgroundColor: '#111418' }, [
		paragraph('Nearly invisible', { color: '#222222' }),
	]);
	assert.equal(isUnreadable(doc), true);
});

test('isUnreadable respects a background painted on an inner container', () => {
	const container = new FakeElement('div', { backgroundColor: '#101010' });
	container.appendChild(paragraph('Light on the inner dark box', { color: '#dddddd' }));
	const doc = fakeDocument({}, [container]);
	assert.equal(isUnreadable(doc), false);
});

test('isUnreadable skips text the email hides and text over background images', () => {
	const doc = fakeDocument({}, [
		paragraph('Hidden copy', { color: '#f0f0f0', display: 'none' }),
		paragraph('Over an image', { color: '#f0f0f0', backgroundImage: 'url(bg.png)' }),
		paragraph('Readable copy', { color: '#1f2937' }),
	]);
	assert.equal(isUnreadable(doc), false);
});

test('isUnreadable treats an empty document as readable', () => {
	assert.equal(isUnreadable(fakeDocument()), false);
});

test('applyContrastFix injects a dark-text repair for light-on-light', () => {
	const doc = fakeDocument({}, [paragraph('Invisible', { color: '#eeeeee' })]);
	assert.equal(applyContrastFix(doc), true);
	const styles = doc.head.childNodes.filter((node) => node.tagName === 'STYLE');
	assert.equal(styles.length, 1);
	assert.ok(styles[0].hasAttribute('data-email-contrast-fix'));
	assert.match(styles[0].textContent, /background:#fff!important/);
	assert.match(styles[0].textContent, /color:#1f2937!important/);
});

test('applyContrastFix injects a light-text repair for dark-on-dark', () => {
	const doc = fakeDocument({ backgroundColor: '#0a0a0a' }, [
		paragraph('Invisible', { color: '#333333' }),
	]);
	assert.equal(applyContrastFix(doc), true);
	const styles = doc.head.childNodes.filter((node) => node.tagName === 'STYLE');
	assert.equal(styles.length, 1);
	assert.match(styles[0].textContent, /background:#111418!important/);
	assert.match(styles[0].textContent, /color:#e8eaed!important/);
});

test('applyContrastFix leaves readable documents alone and never stacks repairs', () => {
	const doc = fakeDocument({}, [paragraph('Readable', { color: '#1f2937' })]);
	assert.equal(applyContrastFix(doc), false);
	assert.equal(doc.head.childNodes.filter((node) => node.tagName === 'STYLE').length, 0);
});

test('removeContrastFix clears the repair', () => {
	const doc = fakeDocument({}, [paragraph('Invisible', { color: '#eeeeee' })]);
	applyContrastFix(doc);
	assert.equal(doc.head.childNodes.filter((node) => node.tagName === 'STYLE').length, 1);
	removeContrastFix(doc);
	assert.equal(doc.head.childNodes.filter((node) => node.tagName === 'STYLE').length, 0);
});

test('ensureReadableContrast re-checks after load and drops a repair that is no longer needed', () => {
	const doc = fakeDocument({}, [paragraph('Invisible', { color: '#eeeeee' })]);
	const cleanup = ensureReadableContrast(doc);
	assert.equal(doc.head.childNodes.filter((node) => node.tagName === 'STYLE').length, 1);
	// The background image arrives late: the email now renders fine on its own.
	doc.body.childNodes[0].styleDecl.backgroundColor = '#101010';
	doc.body.childNodes[0].styleDecl.color = '#e8eaed';
	doc.fire('load');
	assert.equal(doc.head.childNodes.filter((node) => node.tagName === 'STYLE').length, 0);
	cleanup();
	assert.equal(doc.listeners['load'].length, 0);
});

test('ensureReadableContrast cleanup removes the repair', () => {
	const doc = fakeDocument({}, [paragraph('Invisible', { color: '#eeeeee' })]);
	const cleanup = ensureReadableContrast(doc);
	assert.equal(doc.head.childNodes.filter((node) => node.tagName === 'STYLE').length, 1);
	cleanup();
	assert.equal(doc.head.childNodes.filter((node) => node.tagName === 'STYLE').length, 0);
});
