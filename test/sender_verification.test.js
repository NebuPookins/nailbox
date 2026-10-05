import test from 'node:test';
import assert from 'node:assert/strict';

import {verifySender} from '../src/server/services/sender_verification.js';

const results = (value, name = 'Authentication-Results') => ({name, value});

test('an aligned DMARC pass verifies the sender', () => {
	const headers = [results('mx.google.com; spf=pass smtp.mailfrom=b@x.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'verified');
});

test('an aligned DKIM pass verifies the sender even when the domain publishes no DMARC policy', () => {
	const headers = [results('mx.google.com; dkim=pass header.i=@example.com header.s=sel header.b=abc; dmarc=none header.from=example.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'verified');
});

test('a DKIM pass by a parent of the From domain verifies the sender', () => {
	const headers = [results('mx.google.com; dkim=pass header.d=example.com')];
	assert.equal(verifySender(headers, 'al@mail.example.com'), 'verified');
});

test('a DKIM pass by an unrelated domain does not verify the sender', () => {
	const headers = [results('mx.google.com; dkim=pass header.d=esp.net; dmarc=fail header.from=example.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('a DKIM pass by a domain that merely ends with the From domain text does not verify the sender', () => {
	const headers = [results('mx.google.com; dkim=pass header.d=evilexample.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('an SPF pass alone does not verify the sender', () => {
	const headers = [results('mx.google.com; spf=pass smtp.mailfrom=al@example.com; dmarc=none header.from=example.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('a DMARC pass for a different domain than From does not verify the sender', () => {
	const headers = [results('mx.google.com; dmarc=pass header.from=other.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('a failing DMARC result does not verify the sender', () => {
	const headers = [results('mx.google.com; dmarc=fail (p=REJECT) header.from=example.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('a message without an Authentication-Results header is unverified', () => {
	assert.equal(verifySender([{name: 'From', value: 'al@example.com'}], 'al@example.com'), 'unverified');
});

test('a verdict from a server other than Gmail is ignored', () => {
	const headers = [results('mail.attacker.net; dmarc=pass header.from=example.com')];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('a forged Gmail-looking verdict below the topmost one is ignored', () => {
	const headers = [
		results('mx.google.com; dmarc=fail header.from=example.com'),
		results('mx.google.com; dmarc=pass header.from=example.com'),
	];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('the header name and domains are matched case-insensitively', () => {
	const headers = [results('MX.Google.com; DMARC=pass header.from=Example.COM', 'authentication-results')];
	assert.equal(verifySender(headers, 'Al@EXAMPLE.com'), 'verified');
});

test('a message without a usable From address is unverified', () => {
	const headers = [results('mx.google.com; dmarc=pass header.from=example.com')];
	assert.equal(verifySender(headers, undefined), 'unverified');
	assert.equal(verifySender(headers, 'not-an-address'), 'unverified');
});

test('a forged Gmail-looking verdict is ignored when Gmail added no verdict of its own', () => {
	const headers = [
		results('mail.attacker.net; dmarc=pass header.from=example.com'),
		results('mx.google.com; dmarc=pass header.from=example.com'),
	];
	assert.equal(verifySender(headers, 'al@example.com'), 'unverified');
});

test('an aligned DKIM signature counts even when another signature passes after it', () => {
	const headers = [results('mx.google.com; dkim=pass header.i=@example.com header.s=a; dkim=pass header.i=@esp.net header.s=b')];
	assert.equal(verifySender(headers, 'al@example.com'), 'verified');
});
