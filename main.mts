import util from 'util';
import { createServer } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import nebulog from 'nebulog';

import type { AppConfig } from './src/server/types/config.js';
import type { GmailApiRequestOptions } from './services/google_oauth.mjs';

const logger = nebulog.make({filename: 'main.mts', level: 'debug'});
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
import { createThreadUpdatesNotifier } from './src/server/services/thread_updates_notifier.js';
import { startGmailPoller } from './src/server/services/gmail_poller.js';
import { syncRecentThreadsFromGmail } from './src/server/services/gmail_sync_service.js';

const DEFAULT_CONFIG: {port: number} = {
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

function readConfigWithDefault(config: AppConfig, strFieldName: keyof typeof DEFAULT_CONFIG): number {
	return config[strFieldName] ?? DEFAULT_CONFIG[strFieldName];
}

function saveConfig(): Promise<AppConfig> {
	return configRepository.saveConfig(config);
}

function makeGoogleAuthErrorResponse(res: Response, code: string, message: string, status = 401): void {
	res.status(status).send({code, message});
}

type GmailRequest = (options: GmailApiRequestOptions) => Promise<unknown>;

async function withGmailApi<T>(
	res: Response,
	fnCallback: (gmailRequest: GmailRequest) => Promise<T>,
): Promise<T | null> {
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
		const err = error as Error & {code?: string; status?: number};
		if (err.code === 'GOOGLE_REAUTH_REQUIRED') {
			clearGoogleTokens(config);
			await saveConfig();
			makeGoogleAuthErrorResponse(res, 'GOOGLE_REAUTH_REQUIRED', 'Google authorization expired or was revoked.');
			return null;
		}
		if (err.status === 401) {
			makeGoogleAuthErrorResponse(res, 'GOOGLE_REAUTH_REQUIRED', 'Google authorization failed.');
			return null;
		}
		throw error;
	}
}

async function withBackgroundGmailApi<T>(
	fnCallback: (gmailRequest: GmailRequest) => Promise<T>,
): Promise<T | null> {
	if (!isGoogleOAuthConfigured(config)) {
		return null;
	}
	const authStatus = getGoogleAuthStatus(config);
	if (!authStatus.connected) {
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
		const err = error as Error & {code?: string; status?: number};
		if (err.code === 'GOOGLE_REAUTH_REQUIRED' || err.status === 401) {
			clearGoogleTokens(config);
			await saveConfig();
			logger.warn('Google authorization expired for background Gmail polling.');
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const threadRepository = createThreadRepository({ threadModelModule: threadModel as any });
const threadService = createThreadService({ threadRepository, MessageClass: Message, bundles });
const rfc2822Service = createRfc2822Service({ threadRepository });
const threadUpdatesNotifier = createThreadUpdatesNotifier({ logger });

const app = express();
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'pug');
app.locals.assetPath = frontendAssetService.assetPath;
app.use('/public', express.static('public'));
app.use(bodyParser.json({limit: '10mb'}));
app.use(bodyParser.urlencoded({limit: '10mb', parameterLimit: 10000, extended: true }));
app.use(function (req: Request, res: Response, next: NextFunction) {
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
	notifyThreadsChanged: (reason: string) => threadUpdatesNotifier.notifyThreadsChanged(reason),
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

app.use(function(req: Request, res: Response) {
	logger.debug(util.format("Sent 404 in response to %s %s", req.method, req.url));
	res.sendStatus(404);
});

app.use(function(err: Error, req: Request, res: Response, _next: NextFunction) {
	logger.error(err.stack ?? String(err));
	res.sendStatus(500);
});

const server = createServer(app);
server.on('upgrade', function(request, socket) {
	if (threadUpdatesNotifier.handleUpgrade(request, socket)) {
		return;
	}
	socket.destroy();
});
server.listen(readConfigWithDefault(config, 'port'));
logger.info(util.format("Nailbox is running on port %d.", readConfigWithDefault(config, 'port')));

startGmailPoller({
	intervalMs: 5 * 60 * 1000,
	logger,
	notifyThreadsChanged: (reason: string) => threadUpdatesNotifier.notifyThreadsChanged(reason),
	async pollGmail() {
		return withBackgroundGmailApi(async (gmailRequest) => {
			return syncRecentThreadsFromGmail({
				gmailRequest,
				lastRefresheds,
				threadRepository,
				threadService,
			});
		});
	},
});
