import util from 'util';

import { getGoogleAuthStatus, getGoogleOAuthConfig, isGoogleOAuthConfigured } from '../../../services/google_oauth.mjs';
import { normalizeGoogleOAuthSetupDto } from '../validation/contracts.js';

function getDefaultRedirectUri(req) {
	return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

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

export default function registerSetupRoutes(app, dependencies) {
	const {config, logger, saveConfig} = dependencies;

	app.get('/', function(req, res) {
		if (isGoogleOAuthConfigured(config)) {
			res.render('index');
		} else {
			res.redirect('/setup');
		}
	});

	app.get('/setup', function(req, res) {
		res.render('setup', getSetupViewModel(config, req));
	});

	app.post('/setup', async function(req, res) {
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
			if (error.code === 'INVALID_CONTRACT') {
				res.status(400).render('setup', getSetupViewModel(config, req, {
					errorMessage: error.message,
				}));
				return;
			}
			logger.error(util.format('Failed to save config file: %s', util.inspect(error)));
			res.sendStatus(500);
		}
	});

	app.get('/api/clientId', function(req, res) {
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

	app.get('/api/auth/status', function(req, res) {
		res.status(200).send(getGoogleAuthStatus(config));
	});
}

export {
	getDefaultRedirectUri,
	getSetupViewModel,
};
