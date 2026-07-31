import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureValidAccessToken } from '../services/google_oauth.mjs';

function makeConfig() {
	return {
		googleOAuth: {
			clientId: 'client-id',
			clientSecret: 'client-secret',
			redirectUri: 'http://localhost:3000/auth/google/callback',
			refreshToken: 'refresh-token',
			accessToken: 'expired-access-token',
			accessTokenExpiresAt: new Date(Date.now() - 60000).toISOString(),
		},
	};
}

function expireAccessToken(config) {
	config.googleOAuth.accessTokenExpiresAt = new Date(Date.now() - 60000).toISOString();
}

async function withStubbedFetch(stub, fnCallback) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		return await fnCallback();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

function makeTokenResponse(accessToken) {
	return {
		ok: true,
		status: 200,
		text: async () => JSON.stringify({ access_token: accessToken, expires_in: 3600 }),
	};
}

test('concurrent callers share a single access token refresh', async () => {
	const config = makeConfig();
	let refreshCount = 0;

	await withStubbedFetch(async () => {
		refreshCount += 1;
		return makeTokenResponse('fresh-access-token');
	}, async () => {
		const tokenInfos = await Promise.all([
			ensureValidAccessToken(config),
			ensureValidAccessToken(config),
			ensureValidAccessToken(config),
		]);
		for (const tokenInfo of tokenInfos) {
			assert.equal(tokenInfo.accessToken, 'fresh-access-token');
			//Everyone who shared the refresh reports it, so the result gets persisted.
			assert.equal(tokenInfo.didUpdateCredentials, true);
		}
	});

	assert.equal(refreshCount, 1);
	assert.equal(config.googleOAuth.accessToken, 'fresh-access-token');
});

test('a later refresh happens after the shared one settles', async () => {
	const config = makeConfig();
	let refreshCount = 0;

	await withStubbedFetch(async () => {
		refreshCount += 1;
		return makeTokenResponse(`access-token-${refreshCount}`);
	}, async () => {
		const firstTokenInfo = await ensureValidAccessToken(config);
		assert.equal(firstTokenInfo.accessToken, 'access-token-1');
		assert.equal(firstTokenInfo.didUpdateCredentials, true);

		// Still valid, so no refresh should be attempted.
		const cachedTokenInfo = await ensureValidAccessToken(config);
		assert.equal(cachedTokenInfo.accessToken, 'access-token-1');
		assert.equal(cachedTokenInfo.didUpdateCredentials, false);

		expireAccessToken(config);
		const secondTokenInfo = await ensureValidAccessToken(config);
		assert.equal(secondTokenInfo.accessToken, 'access-token-2');
		assert.equal(secondTokenInfo.didUpdateCredentials, true);
	});

	assert.equal(refreshCount, 2);
});

test('every concurrent caller sees the failure of a shared refresh', async () => {
	const config = makeConfig();
	let refreshCount = 0;

	await withStubbedFetch(async () => {
		refreshCount += 1;
		return {
			ok: false,
			status: 400,
			text: async () => JSON.stringify({ error: 'invalid_grant' }),
		};
	}, async () => {
		const results = await Promise.allSettled([
			ensureValidAccessToken(config),
			ensureValidAccessToken(config),
		]);
		for (const result of results) {
			assert.equal(result.status, 'rejected');
			assert.equal(result.reason.code, 'GOOGLE_REAUTH_REQUIRED');
		}
	});

	assert.equal(refreshCount, 1);
});
