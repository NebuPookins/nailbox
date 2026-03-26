import util from 'util';

import type {Application, Request, Response} from 'express';

import {getGoogleAuthStatus, getGoogleOAuthConfig, isGoogleOAuthConfigured} from '../../../services/google_oauth.mjs';
import {normalizeGoogleOAuthSetupDto} from '../validation/contracts.js';

function getDefaultRedirectUri(req: Request): string {
	return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

function getSetupViewModel(config: any, req: Request, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const googleOAuth = getGoogleOAuthConfig(config);
	return Object.assign({
		googleOAuth,
		authStatus: getGoogleAuthStatus(config),
		defaultRedirectUri: getDefaultRedirectUri(req),
		errorMessage: null,
		successMessage: null,
	}, overrides);
}

export default function registerSetupRoutes(app: Application, dependencies: any): void {
	const {config, logger, saveConfig} = dependencies;

	app.get('/', function(req: Request, res: Response) {
		if (isGoogleOAuthConfigured(config)) {
			res.render('index');
		} else {
			res.redirect('/setup');
		}
	});

	app.get('/setup', function(req: Request, res: Response) {
		res.render('setup', getSetupViewModel(config, req));
	});

	app.post('/setup', async function(req: Request, res: Response) {
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
			const err = error as Error & {code?: string};
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

	app.get('/api/clientId', function(req: Request, res: Response) {
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

	app.get('/api/auth/status', function(req: Request, res: Response) {
		res.status(200).send(getGoogleAuthStatus(config));
	});
}

export {
	getDefaultRedirectUri,
	getSetupViewModel,
};
