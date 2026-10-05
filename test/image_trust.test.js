import test from 'node:test';
import assert from 'node:assert/strict';

import {remoteContentFor, senderToTrustFor} from '../src/frontend/image_trust.js';

const message = (senderVerification, email = 'Al@Example.com') => ({
	messageId: 'm1',
	from: [{name: 'Al', email}],
	senderVerification,
});

test('images load for a trusted sender whose message is verified', () => {
	assert.equal(remoteContentFor(['al@example.com'], new Set(), message('verified')), 'allowed');
});

test('images stay blocked for a trusted sender whose message is unverified', () => {
	assert.equal(remoteContentFor(['al@example.com'], new Set(), message('unverified')), 'blocked');
});

test('images stay blocked for a verified sender who is not trusted', () => {
	assert.equal(remoteContentFor(['bo@example.com'], new Set(), message('verified')), 'blocked');
});

test('images stay blocked for a message without a sender address', () => {
	assert.equal(remoteContentFor([''], new Set(), {messageId: 'm1', from: [null], senderVerification: 'verified'}), 'blocked');
});

test('images load for a message the user asked to load, even from an unverified sender', () => {
	assert.equal(remoteContentFor([], new Set(['m1']), message('unverified')), 'allowed');
});

test('always-load is offered only for a verified sender, under their normalized address', () => {
	assert.equal(senderToTrustFor(message('verified')), 'al@example.com');
	assert.equal(senderToTrustFor(message('unverified')), undefined);
});
