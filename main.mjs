// @ts-nocheck
import util from 'util';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import nebulog from 'nebulog';
const logger = nebulog.make({filename: 'main.mjs', level: 'debug'});
import helpers_fileio from './helpers/fileio.js';

import threadModel from './models/thread.js';
import { Message } from './models/message.js';
import bundleModel from './models/bundle.js';
import { createThreadRepository } from './src/server/repositories/thread_repository.js';
import { createThreadService } from './src/server/services/thread_service.js';
import { createRfc2822Service } from './src/server/services/rfc2822_service.js';
import hideUntilRepository from './src/server/repositories/hide_until_repository.js';
import lastRefreshedRepository from './src/server/repositories/last_refreshed_repository.js';
import {
	clearGoogleTokens,
	getGoogleAuthStatus,
	gmailApiRequest,
	isGoogleOAuthConfigured,
} from './services/google_oauth.mjs';
import registerAuthRoutes from './src/server/routes/auth_routes.js';
import registerThreadActionRoutes from './src/server/routes/thread_action_routes.js';
import configRepository from './src/server/repositories/config_repository.js';
import registerSetupRoutes from './src/server/routes/setup_routes.js';
import registerThreadRoutes from './src/server/routes/thread_routes.js';
import registerBundleRoutes from './src/server/routes/bundle_routes.js';
import frontendAssetService from './src/server/services/frontend_asset_service.js';

const DEFAULT_CONFIG = {
	port: 3000,
};

/*
 * Set up graceful exit, because otherwise there's a race condition
 * where the process might be killed in the middle of IO, which will
 * result in corrupt JSON files.
 */
process.on('SIGINT', () => {
	console.log("\n"); //Print newline because CTRL-C usually causes "^C" to get printed to the terminal, and we want the next log message to be on its own line.
	logger.info("Gracefully shutting down from SIGINT (Ctrl-C)...");
	process.exit( );
});

function readConfigWithDefault(config, strFieldName) {
	if (config[strFieldName]) {
		return config[strFieldName];
	} else {
		return DEFAULT_CONFIG[strFieldName];
	}
}

function saveConfig() {
	return configRepository.saveConfig(config);
}

function makeGoogleAuthErrorResponse(res, code, message, status = 401) {
	return res.status(status).send({
		code: code,
		message: message,
	});
}

async function withGmailApi(res, fnCallback) {
	if (!isGoogleOAuthConfigured(config)) {
		makeGoogleAuthErrorResponse(res, 'GOOGLE_AUTH_MISCONFIGURED', 'Google OAuth is not configured.', 503);
		return null;
	}
	const authStatus = getGoogleAuthStatus(config);
	if (!authStatus.connected) {
		makeGoogleAuthErrorResponse(res, 'GOOGLE_REAUTH_REQUIRED', 'Google authorization is required.');
		return null;
	}
	try {
		const result = await fnCallback(async (options) => {
			const gmailResult = await gmailApiRequest(config, options);
			if (gmailResult.didUpdateCredentials) {
				await saveConfig();
			}
			return gmailResult.data;
		});
		return result;
	} catch (error) {
		if (error.code === 'GOOGLE_REAUTH_REQUIRED') {
			clearGoogleTokens(config);
			await saveConfig();
			makeGoogleAuthErrorResponse(res, 'GOOGLE_REAUTH_REQUIRED', 'Google authorization expired or was revoked.');
			return null;
		}
		if (error.status === 401) {
			makeGoogleAuthErrorResponse(res, 'GOOGLE_REAUTH_REQUIRED', 'Google authorization failed.');
			return null;
		}
		throw error;
	}
}

logger.info("Checking directory structure...");
await helpers_fileio.ensureDirectoryExists('data/threads');
logger.info("Directory structure looks fine.");
const hideUntils = await hideUntilRepository.load();
const lastRefresheds = await lastRefreshedRepository.load();
const bundles = await bundleModel.load();
const config = await configRepository.readConfig();
const threadRepository = createThreadRepository({ threadModelModule: threadModel });
const threadService = createThreadService({ threadRepository, MessageClass: Message });
const rfc2822Service = createRfc2822Service({ threadRepository });

const app = express();
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'pug');
app.locals.assetPath = frontendAssetService.assetPath;
app.use('/public', express.static('public'));
app.use(bodyParser.json({limit: '10mb', parameterLimit: 10000}));
app.use(bodyParser.urlencoded({limit: '10mb', parameterLimit: 10000, extended: true }));
app.use(function (req, res, next) {
	//Log each request.
	logger.info(util.format("%s %s => %s %s %s", new Date().toISOString(), req.ip, req.protocol, req.method, req.url));
	next();
});

const routeDependencies = {
	bundles,
	config,
	helpersFileio: helpers_fileio,
	hideUntils,
	lastRefresheds,
	logger,
	configRepository,
	saveConfig,
	rfc2822Service,
	threadRepository,
	threadService,
	withGmailApi,
};

registerSetupRoutes(app, routeDependencies);
registerAuthRoutes(app, routeDependencies);
registerThreadRoutes(app, routeDependencies);
registerBundleRoutes(app, routeDependencies);
registerThreadActionRoutes(app, routeDependencies);

app.use(function(req, res) {
	logger.debug(util.format("Sent 404 in response to %s %s", req.method, req.url));
	res.sendStatus(404);
});

app.use(function(err, req, res, next) {
	logger.error(err.stack);
	res.sendStatus(500);
});

app.listen(readConfigWithDefault(config, 'port'));
logger.info(util.format("Nailbox is running on port %d.", readConfigWithDefault(config, 'port')));
