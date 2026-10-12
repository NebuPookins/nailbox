import util from 'util';

import type {Application, Request, Response} from 'express';

import {getGoogleAuthStatus, getGoogleOAuthConfig, isGoogleOAuthConfigured} from '../../../services/google_oauth.mjs';
import {normalizeGoogleOAuthSetupDto, normalizeProfileSetupDto} from '../validation/contracts.js';
import frontendAssetService from '../services/frontend_asset_service.js';
import type {AppConfig} from '../types/config.js';
import {renderIndexPage} from '../views/index_page.js';
import type {GoogleOAuthViewModel, PageNotice} from '../views/page.js';
import {renderProfilePage} from '../views/profile_page.js';
import {renderSetupPage} from '../views/setup_page.js';

function getDefaultRedirectUri(req: Request): string {
	return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

function getSetupViewModel(config: AppConfig, req: Request, notice?: PageNotice): GoogleOAuthViewModel {
	return {
		stylesheetPath: frontendAssetService.assetPath('styles.css'),
		googleOAuth: getGoogleOAuthConfig(config),
		authStatus: getGoogleAuthStatus(config),
		defaultRedirectUri: getDefaultRedirectUri(req),
		notice,
	};
}

export default function registerSetupRoutes(app: Application, dependencies: any): void {
	const {config, logger, saveConfig} = dependencies;

	app.get('/', function(req: Request, res: Response) {
		if (isGoogleOAuthConfigured(config)) {
			res.send(renderIndexPage({
				mainScriptPath: frontendAssetService.assetPath('main.ts'),
				stylesheetPath: frontendAssetService.assetPath('styles.css'),
			}));
		} else {
			res.redirect('/setup');
		}
	});

	app.get('/setup', function(req: Request, res: Response) {
		res.send(renderSetupPage(getSetupViewModel(config, req)));
	});

	function renderProfile(req: Request, notice?: PageNotice): string {
		return renderProfilePage({
			...getSetupViewModel(config, req, notice),
			anthropic: config.anthropic ?? {},
		});
	}

	app.get('/profile', function(req: Request, res: Response) {
		res.send(renderProfile(req));
	});

	app.post('/profile', async function(req: Request, res: Response) {
		try {
			const profile = normalizeProfileSetupDto(req.body, getDefaultRedirectUri(req), config.anthropic ?? {});
			Object.assign(getGoogleOAuthConfig(config), profile.googleOAuth);
			config.anthropic = profile.anthropic;
			await saveConfig();
			res.send(renderProfile(req, {kind: 'success', text: 'Profile settings saved.'}));
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).send(renderProfile(req, {kind: 'error', text: err.message}));
				return;
			}
			logger.error(util.format('Failed to save profile config: %s', util.inspect(error)));
			res.sendStatus(500);
		}
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
			res.send(renderSetupPage(getSetupViewModel(config, req, {
				kind: 'success',
				text: 'Google OAuth configuration saved.',
			})));
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).send(renderSetupPage(getSetupViewModel(config, req, {
					kind: 'error',
					text: err.message,
				})));
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
