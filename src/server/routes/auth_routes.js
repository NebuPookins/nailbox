import crypto from 'node:crypto';
import util from 'util';

import {
	GOOGLE_SCOPE,
	clearGoogleTokens,
	exchangeCodeForTokens,
	getAuthorizationUrl,
	getGoogleAuthStatus,
	getGoogleOAuthConfig,
	gmailApiRequest,
	isGoogleOAuthConfigured,
} from '../../../services/google_oauth.mjs';
import { getSetupViewModel } from './setup_routes.js';

function setCookie(res, name, value, options = {}) {
	const parts = [`${name}=${encodeURIComponent(value)}`];
	parts.push(`Path=${options.path || '/'}`);
	parts.push(`SameSite=${options.sameSite || 'Lax'}`);
	if (options.httpOnly !== false) {
		parts.push('HttpOnly');
	}
	if (options.maxAgeSeconds !== undefined) {
		parts.push(`Max-Age=${options.maxAgeSeconds}`);
	}
	if (options.secure) {
		parts.push('Secure');
	}
	res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name, options = {}) {
	setCookie(res, name, '', Object.assign({}, options, {maxAgeSeconds: 0}));
}

function parseCookies(req) {
	const rawCookieHeader = req.headers.cookie;
	if (typeof rawCookieHeader !== 'string' || rawCookieHeader.length === 0) {
		return {};
	}
	return rawCookieHeader.split(';').reduce((cookies, chunk) => {
		const trimmedChunk = chunk.trim();
		const equalsIndex = trimmedChunk.indexOf('=');
		if (equalsIndex === -1) {
			return cookies;
		}
		const key = trimmedChunk.substring(0, equalsIndex);
		const value = trimmedChunk.substring(equalsIndex + 1);
		cookies[key] = decodeURIComponent(value);
		return cookies;
	}, {});
}

export default function registerAuthRoutes(app, dependencies) {
	const {config, logger, saveConfig} = dependencies;

	app.get('/auth/google/start', function(req, res) {
		if (!isGoogleOAuthConfigured(config)) {
			res.redirect('/setup');
			return;
		}
		const state = crypto.randomBytes(24).toString('hex');
		setCookie(res, 'google_oauth_state', state, {
			path: '/auth/google/callback',
			maxAgeSeconds: 10 * 60,
		});
		const authStatus = getGoogleAuthStatus(config);
		const prompt = authStatus.connected ? null : 'consent';
		res.redirect(getAuthorizationUrl(config, state, prompt));
	});

	app.get('/auth/google/callback', async function(req, res) {
		const cookies = parseCookies(req);
		clearCookie(res, 'google_oauth_state', {path: '/auth/google/callback'});
		if (!req.query.state || req.query.state !== cookies.google_oauth_state) {
			res.status(400).render('setup', getSetupViewModel(config, req, {
				errorMessage: 'Google OAuth state validation failed. Please try connecting again.',
			}));
			return;
		}
		if (req.query.error) {
			res.status(400).render('setup', getSetupViewModel(config, req, {
				errorMessage: `Google authorization failed: ${req.query.error}`,
			}));
			return;
		}
		try {
			const tokenResponse = await exchangeCodeForTokens(config, req.query.code);
			const googleOAuth = getGoogleOAuthConfig(config);
			googleOAuth.accessToken = tokenResponse.access_token;
			googleOAuth.accessTokenExpiresAt = new Date(Date.now() + ((tokenResponse.expires_in || 3600) * 1000)).toISOString();
			if (typeof tokenResponse.refresh_token === 'string' && tokenResponse.refresh_token.length > 0) {
				googleOAuth.refreshToken = tokenResponse.refresh_token;
			}
			if (typeof tokenResponse.scope === 'string' && tokenResponse.scope.length > 0) {
				googleOAuth.scope = tokenResponse.scope;
			} else {
				googleOAuth.scope = GOOGLE_SCOPE;
			}
			if (typeof googleOAuth.refreshToken !== 'string' || googleOAuth.refreshToken.length === 0) {
				throw new Error('Google did not return a refresh token. Reconnect after removing prior grants or ensure consent is forced.');
			}
			const profile = await gmailApiRequest(config, {
				path: '/profile',
			});
			googleOAuth.connectedEmailAddress = profile.data.emailAddress;
			await saveConfig();
			res.redirect('/?googleAuth=success');
		} catch (error) {
			logger.error(util.format('Failed during Google OAuth callback: %s', util.inspect(error)));
			res.status(500).render('setup', getSetupViewModel(config, req, {
				errorMessage: 'Failed to complete Google OAuth setup. Verify client ID, client secret, and redirect URI.',
			}));
		}
	});

	app.post('/auth/google/disconnect', async function(req, res) {
		clearGoogleTokens(config);
		try {
			await saveConfig();
			if ((req.get('accept') || '').indexOf('text/html') !== -1) {
				res.redirect('/setup');
				return;
			}
			res.sendStatus(204);
		} catch (error) {
			logger.error(util.format('Failed to clear Google OAuth config: %s', util.inspect(error)));
			res.sendStatus(500);
		}
	});
}

export {
	clearCookie,
	parseCookies,
	setCookie,
};
