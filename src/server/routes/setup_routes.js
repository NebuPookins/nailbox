import util from 'util';

import { getGoogleAuthStatus, getGoogleOAuthConfig, isGoogleOAuthConfigured } from '../../../services/google_oauth.mjs';
import { normalizeGoogleOAuthSetupDto } from '../validation/contracts.js';

/**
 * @param {import('express').Request} req
 */
function getDefaultRedirectUri(req) {
	return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

/**
 * @param {any} config
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} [overrides]
 */
function getSetupViewModel(config, req, overrides = {}) {
	const googleOAuth = getGoogleOAuthConfig(config);
	return Object.assign({
		googleOAuth,
		authStatus: getGoogleAuthStatus(config),
		defaultRedirectUri: getDefaultRedirectUri(req),
		errorMessage: null,
		successMessage: null,
	}, overrides);
}

/**
 * @param {import('express').Application} app
 * @param {any} dependencies
 */
export default function registerSetupRoutes(app, dependencies) {
	const {config, logger, saveConfig} = dependencies;

	app.get('/', function(/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) {
		if (isGoogleOAuthConfigured(config)) {
			res.render('index');
		} else {
			res.redirect('/setup');
		}
	});

	app.get('/setup', function(/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) {
		res.render('setup', getSetupViewModel(config, req));
	});

	app.post('/setup', async function(/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) {
		try {
			const googleOAuthSetup = normalizeGoogleOAuthSetupDto(req.body, getDefaultRedirectUri(req));
			const googleOAuth = getGoogleOAuthConfig(config);
			googleOAuth.clientId = googleOAuthSetup.clientId;
			googleOAuth.clientSecret = googleOAuthSetup.clientSecret;
			googleOAuth.redirectUri = googleOAuthSetup.redirectUri;
			logger.info('Updating Google OAuth configuration.');
			await saveConfig();
			res.render('setup', getSetupViewModel(config, req, {
				successMessage: 'Google OAuth configuration saved.',
			}));
		} catch (error) {
			const err = /** @type {Error & {code?: string}} */ (error);
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).render('setup', getSetupViewModel(config, req, {
					errorMessage: err.message,
				}));
				return;
			}
			logger.error(util.format('Failed to save config file: %s', util.inspect(error)));
			res.sendStatus(500);
		}
	});

	app.get('/api/clientId', function(/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) {
		const clientId = getGoogleOAuthConfig(config).clientId;
		if (typeof clientId === 'string') {
			res
				.status(200)
				.set('Content-Type', 'text/plain')
				.send(clientId);
			return;
		}
		res.sendStatus(404);
	});

	app.get('/api/auth/status', function(/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) {
		res.status(200).send(getGoogleAuthStatus(config));
	});
}

export {
	getDefaultRedirectUri,
	getSetupViewModel,
};
