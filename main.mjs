const DEFAULT_CONFIG = {
	port: 3000
};
const PATH_TO_CONFIG = 'data/config.json';

import util from 'util';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import crypto from 'node:crypto';
import nebulog from 'nebulog';
const logger = nebulog.make({filename: 'main.mjs', level: 'debug'});
import _ from 'lodash';
import mailcomposer from 'mailcomposer';
import { marked } from 'marked';
import base64url from 'base64url';
import hljs from 'highlight.js';
import posthtml from 'posthtml';
import Optional from 'optional-js';
import helpers_fileio from './helpers/fileio.js';

import models_thread from './models/thread.js';
import models_hideUntils from './models/hide_until.js';
import models_lastRefreshed from './models/last_refreshed.js';
import {
	GOOGLE_SCOPE,
	clearGoogleTokens,
	exchangeCodeForTokens,
	getAuthorizationUrl,
	getGoogleAuthStatus,
	getGoogleOAuthConfig,
	gmailApiRequest,
	isGoogleOAuthConfigured,
} from './services/google_oauth.mjs';
import {
	getEmailGroupingRules,
	groupThreads,
} from './src/server/domain/grouping_rules.js';
import threadRepository from './src/server/repositories/thread_repository.js';
import threadService from './src/server/services/thread_service.js';
import {
	normalizeAppConfig,
	normalizeGroupingRulesConfig,
} from './src/server/validation/contracts.js';

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

function getDefaultRedirectUri(req) {
	return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

function saveConfig() {
	return helpers_fileio.saveJsonToFile(config, PATH_TO_CONFIG);
}

function getSetupViewModel(req, overrides = {}) {
	const googleOAuth = getGoogleOAuthConfig(config);
	return Object.assign({
		googleOAuth: googleOAuth,
		authStatus: getGoogleAuthStatus(config),
		defaultRedirectUri: getDefaultRedirectUri(req),
		errorMessage: null,
		successMessage: null,
	}, overrides);
}

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
const [rawConfig, hideUntils, lastRefresheds] = await Promise.all([
	helpers_fileio.readJsonFromOptionalFile(PATH_TO_CONFIG),
	models_hideUntils.load(),
	models_lastRefreshed.load(),
]);
const config = normalizeAppConfig(rawConfig);

const app = express();
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'pug');
app.use('/public', express.static('public'));
app.use(bodyParser.json({limit: '10mb', parameterLimit: 10000}));
app.use(bodyParser.urlencoded({limit: '10mb', parameterLimit: 10000, extended: true }));
app.use(function (req, res, next) {
	//Log each request.
	logger.info(util.format("%s %s => %s %s %s", new Date().toISOString(), req.ip, req.protocol, req.method, req.url));
	next();
});

app.get('/', function(req, res) {
	if (isGoogleOAuthConfigured(config)) {
		res.render('index');
	} else {
		res.redirect('/setup');
	}
});

app.get('/setup', function(req, res) {
	res.render('setup', getSetupViewModel(req));
});

app.post('/setup', function(req, res) {
	const googleOAuth = getGoogleOAuthConfig(config);
	googleOAuth.clientId = (req.body.clientId || '').trim();
	googleOAuth.clientSecret = (req.body.clientSecret || '').trim();
	googleOAuth.redirectUri = (req.body.redirectUri || getDefaultRedirectUri(req)).trim();
	logger.info('Updating Google OAuth configuration.');
	saveConfig().then(function() {
		res.render('setup', getSetupViewModel(req, {
			successMessage: 'Google OAuth configuration saved.',
		}));
	}, function(err) {
		logger.error(util.format("Failed to save config file: %s", util.inspect(err)));
		res.sendStatus(500);
	});
});

app.get('/api/clientId', function(req, res) {
	const clientId = getGoogleOAuthConfig(config).clientId;
	if (typeof clientId === 'string') {
		res
			.status(200)
			.set('Content-Type', 'text/plain')
			.send(clientId);
	} else {
		res.sendStatus(404);
	}
});

app.get('/api/auth/status', function(req, res) {
	res.status(200).send(getGoogleAuthStatus(config));
});

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
		res.status(400).render('setup', getSetupViewModel(req, {
			errorMessage: 'Google OAuth state validation failed. Please try connecting again.',
		}));
		return;
	}
	if (req.query.error) {
		res.status(400).render('setup', getSetupViewModel(req, {
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
		res.status(500).render('setup', getSetupViewModel(req, {
			errorMessage: 'Failed to complete Google OAuth setup. Verify client ID, client secret, and redirect URI.',
		}));
	}
});

app.post('/auth/google/disconnect', function(req, res) {
	clearGoogleTokens(config);
	saveConfig().then(function() {
		if ((req.get('accept') || '').indexOf('text/html') !== -1) {
			res.redirect('/setup');
			return;
		}
		res.sendStatus(204);
	}, function(err) {
		logger.error(util.format('Failed to clear Google OAuth config: %s', util.inspect(err)));
		res.sendStatus(500);
	});
});

app.post('/api/threads', async function(req, res) {
	try {
		const result = await threadService.saveThreadPayload({
			threadPayload: req.body,
			lastRefresheds,
		});
		if (result.body) {
			res.status(result.status).send(result.body);
			return;
		}
		res.sendStatus(result.status);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

async function listThreadIdsByLabel(gmailRequest, labelId) {
	const response = await gmailRequest({
		path: '/threads',
		query: {
			labelIds: [labelId],
			maxResults: '100',
		},
	});
	return Array.isArray(response.threads) ? response.threads.map((thread) => thread.id) : [];
}

async function refreshSingleThreadFromGmail(gmailRequest, threadId) {
	try {
		const gmailThread = await gmailRequest({
			path: `/threads/${threadId}`,
			query: {
				format: 'full',
			},
		});
		return threadService.saveThreadPayload({
			threadPayload: gmailThread,
			lastRefresheds,
		});
	} catch (error) {
		if (error.status === 404) {
			return {
				status: await threadRepository.deleteThread(threadId) ? 200 : 500,
			};
		}
		throw error;
	}
}

async function syncRecentThreadsFromGmail(gmailRequest) {
	const [inboxThreadIds, trashThreadIds] = await Promise.all([
		listThreadIdsByLabel(gmailRequest, 'INBOX'),
		listThreadIdsByLabel(gmailRequest, 'TRASH'),
	]);
	const uniqueThreadIds = _.uniq(inboxThreadIds.concat(trashThreadIds));
	const threadSaveResults = await Promise.all(uniqueThreadIds.map(async (threadId) => {
		const saveResult = await refreshSingleThreadFromGmail(gmailRequest, threadId);
		return {
			threadId: threadId,
			status: saveResult.status,
		};
	}));
	return {
		threadIds: uniqueThreadIds,
		results: threadSaveResults,
	};
}

app.get('/api/gmail/profile', async function(req, res) {
	try {
		const profile = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				path: '/profile',
			});
		});
		// TODO: Refactor withGmailApi so this contract is explicit.
		// Today, a null result here means withGmailApi already sent the HTTP error
		// response (for example 401/503), so returning without sending again is correct.
		if (profile == null) {
			return;
		}
		res.status(200).send(profile);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.get('/api/gmail/labels', async function(req, res) {
	try {
		const labelsResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				path: '/labels',
			});
		});
		if (labelsResponse == null) {
			return;
		}
		const labels = Array.isArray(labelsResponse.labels) ? labelsResponse.labels : [];
		res.status(200).send(_.sortBy(labels, function(label) {
			return (label.type === 'system' ? 'A' : 'B') + label.name.toLowerCase();
		}));
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post('/api/gmail/sync', async function(req, res) {
	try {
		const syncResult = await withGmailApi(res, async (gmailRequest) => {
			return syncRecentThreadsFromGmail(gmailRequest);
		});
		if (syncResult == null) {
			return;
		}
		res.status(200).send({
			syncedThreadCount: syncResult.threadIds.length,
			results: syncResult.results,
		});
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post(/^\/api\/gmail\/threads\/([a-z0-9]+)\/refresh$/, async function(req, res) {
	const threadId = req.params[0];
	try {
		const refreshResult = await withGmailApi(res, async (gmailRequest) => {
			return refreshSingleThreadFromGmail(gmailRequest, threadId);
		});
		if (refreshResult == null) {
			return;
		}
		res.sendStatus(refreshResult.status);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post(/^\/api\/threads\/([a-z0-9]+)\/trash$/, async function(req, res) {
	const threadId = req.params[0];
	try {
		const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				method: 'POST',
				path: `/threads/${threadId}/trash`,
			});
		});
		if (gmailResponse == null) {
			return;
		}
		const isSuccessful = await threadRepository.deleteThread(threadId);
		if (isSuccessful) {
			res.status(200).send(gmailResponse);
		} else {
			res.sendStatus(500);
		}
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post(/^\/api\/threads\/([a-z0-9]+)\/archive$/, async function(req, res) {
	const threadId = req.params[0];
	try {
		const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				method: 'POST',
				path: `/threads/${threadId}/modify`,
				json: {
					removeLabelIds: ['INBOX'],
				},
			});
		});
		if (gmailResponse == null) {
			return;
		}
		const isSuccessful = await threadRepository.deleteThread(threadId);
		if (isSuccessful) {
			res.status(200).send(gmailResponse);
		} else {
			res.sendStatus(500);
		}
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post(/^\/api\/threads\/([a-z0-9]+)\/move$/, async function(req, res) {
	const threadId = req.params[0];
	if (typeof req.body.labelId !== 'string' || req.body.labelId.length === 0) {
		res.status(400).send({humanErrorMessage: 'invalid labelId'});
		return;
	}
	try {
		const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				method: 'POST',
				path: `/threads/${threadId}/modify`,
				json: {
					removeLabelIds: ['INBOX', 'UNREAD'],
					addLabelIds: [req.body.labelId],
				},
			});
		});
		if (gmailResponse == null) {
			return;
		}
		const isSuccessful = await threadRepository.deleteThread(threadId);
		if (isSuccessful) {
			res.status(200).send(gmailResponse);
		} else {
			res.sendStatus(500);
		}
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post(/^\/api\/gmail\/threads\/([a-z0-9]+)\/trash$/, async function(req, res) {
	const threadId = req.params[0];
	try {
		const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				method: 'POST',
				path: `/threads/${threadId}/trash`,
			});
		});
		if (gmailResponse == null) {
			return;
		}
		res.status(200).send(gmailResponse);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post(/^\/api\/gmail\/threads\/([a-z0-9]+)\/archive$/, async function(req, res) {
	const threadId = req.params[0];
	try {
		const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				method: 'POST',
				path: `/threads/${threadId}/modify`,
				json: {
					removeLabelIds: ['INBOX'],
				},
			});
		});
		if (gmailResponse == null) {
			return;
		}
		res.status(200).send(gmailResponse);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post(/^\/api\/gmail\/threads\/([a-z0-9]+)\/move$/, async function(req, res) {
	const threadId = req.params[0];
	if (typeof req.body.labelId !== 'string' || req.body.labelId.length === 0) {
		res.status(400).send({humanErrorMessage: 'invalid labelId'});
		return;
	}
	try {
		const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				method: 'POST',
				path: `/threads/${threadId}/modify`,
				json: {
					removeLabelIds: ['INBOX', 'UNREAD'],
					addLabelIds: [req.body.labelId],
				},
			});
		});
		if (gmailResponse == null) {
			return;
		}
		res.status(200).send(gmailResponse);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.post('/api/gmail/messages/send', async function(req, res) {
	if (typeof req.body.threadId !== 'string' || typeof req.body.raw !== 'string') {
		res.status(400).send({humanErrorMessage: 'invalid message payload'});
		return;
	}
	try {
		const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				method: 'POST',
				path: '/messages/send',
				json: {
					threadId: req.body.threadId,
					raw: req.body.raw,
				},
			});
		});
		if (gmailResponse == null) {
			return;
		}
		res.status(200).send(gmailResponse);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.get(/^\/api\/gmail\/messages\/([a-z0-9]+)\/attachments\/([a-zA-Z0-9_-]+)$/, async function(req, res) {
	const messageId = req.params[0];
	const attachmentId = req.params[1];
	try {
		const attachment = await withGmailApi(res, async (gmailRequest) => {
			return gmailRequest({
				path: `/messages/${messageId}/attachments/${attachmentId}`,
			});
		});
		if (attachment == null) {
			return;
		}
		res.status(200).send(attachment);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});


/**
 * Returns a promise with the N most relevant threads (newly received threads,
 * and snoozed threads whose snooze have expired, etc.). Specifically, returns
 * an array of objects.
 */
/**
 * Replies with a list of threads to show on the main page.
 */
app.get('/api/threads', async function(req, res) {
	try {
		const formattedThreads = await threadService.getMostRelevantThreads({
			hideUntils,
			lastRefresheds,
			limit: 100,
		});
		res.status(200);
		res.type('application/json');
		res.send(formattedThreads);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

/**
 * Get email grouping rules
 */
app.get('/api/email-grouping-rules', function(req, res) {
	try {
		const rules = getEmailGroupingRules(config);
		res.status(200);
		res.type('application/json');
		res.send(rules);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

/**
 * Update email grouping rules
 */
app.post('/api/email-grouping-rules', function(req, res) {
	try {
		logger.info("Updating email grouping rules");
		config.emailGroupingRules = normalizeGroupingRulesConfig(req.body);
		helpers_fileio.saveJsonToFile(config, PATH_TO_CONFIG).then(function() {
			res.sendStatus(200);
		}, function(err) {
			logger.error(util.format("Failed to save config file: %s", util.inspect(err)));
			res.sendStatus(500);
		});
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

/**
 * Replies with a list of threads to show on the main page, but grouped by
 * categories
 */
app.get('/api/threads/grouped', async function(req, res) {
	try {
		const allThreads = await threadService.getMostRelevantThreads({
			hideUntils,
			lastRefresheds,
			limit: 100,
		});
		const groupingRules = getEmailGroupingRules(config);
		const orderedGroupThreads = groupThreads({
			threads: allThreads,
			groupingRules,
			hideUntilComparator: hideUntils.comparator(),
		});
		res.status(200);
		res.type('application/json');
		res.send(orderedGroupThreads);
	} catch(err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

app.delete(/^\/api\/threads\/([a-z0-9]+)$/, function(req, res) {
	const threadId = req.params[0];
	logger.info(util.format("Receive request to delete thread %s.", threadId));
	threadRepository.deleteThread(threadId).then((isSuccessful) => {
		res.sendStatus(isSuccessful ? 200 : 500);
	}).catch((err) => {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	});
});

app.put(/^\/api\/threads\/([a-z0-9]+)\/hideUntil$/, function(req, res) {
	const threadId = req.params[0];
	const hideUntil = req.body;
	var promiseHideUntilIsSaved;
	switch (hideUntil.type) {
		case 'timestamp':
			const hideUntilTimestamp = parseInt(hideUntil.value);
			logger.info(`Hiding thread ${threadId} until timestamp ${hideUntilTimestamp}.`);
			promiseHideUntilIsSaved = hideUntils.hideUntilTimestamp(threadId, hideUntilTimestamp);
			break;
		case 'when-i-have-time':
			logger.info(`Hiding thread ${threadId} until I have time.`);
			promiseHideUntilIsSaved = hideUntils.hideUntilIHaveTime(threadId);
			break;
		default:
			logger.error(`Don't know how to handle hideUntil.type ${hideUntil.type}.`);
			res.status(400).send("Invalid hideUntil.type");
			return;
	}
	promiseHideUntilIsSaved.then(function() {
		res.sendStatus(200);
	}, function(err) {
		logger.error(util.format("Failed to save hideUntils: %j", err));
		res.sendStatus(500);
	});
	return;
});

app.get(/^\/api\/threads\/([a-z0-9]+)\/messages$/, function(req, res) {
	const threadId = req.params[0];
	threadService.getThreadMessages(threadId).then(function(result) {
		res.status(200).send(result.data);
	}, function(err) {
		if (err.code === 'ENOENT') {
			res.sendStatus(404);
		} else {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}
	});
});


app.post(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)\/wordcount$/, function(req, res) {
	const threadId = req.params[0];
	const messageId = req.params[1];
	const wordcount = req.body.wordcount;
	if (typeof wordcount !== 'string' && typeof wordcount !== 'number') {
		res.status(400).send({ humanErrorMessage: "invalid wordcount" });
		return;
	}
	threadService.updateMessageWordCount({
		threadId,
		messageId,
		wordcount,
	}).then(function(result) {
		if (result.status === 404) {
			res.sendStatus(404);
			return;
		}
		res.sendStatus(200);
	}, function(err) {
		if (err.code === 'INVALID_CONTRACT') {
			res.status(400).send({humanErrorMessage: err.message});
			return;
		}
		if (err.code === 'ENOENT') {
			res.sendStatus(404);
		} else {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}
	});
});

app.get(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)$/, function(req, res) {
	const threadId = req.params[0];
	const messageId = req.params[1];
	threadService.getThreadMessage(threadId, messageId).then(function(result) {
		if (result.status === 404) {
			res.sendStatus(404);
			return;
		}
		res.status(200).send(result.data);
	}, function(err) {
		if (err.code === 'ENOENT') {
			res.sendStatus(404);
		} else {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}
	});
});

/**
 * Conceptually, this really should be an idempotent GET operation. You give
 * a JSON describing an e-mail, with the body in Markdown format. It then
 * generates the base64url encoded stream of characters which, when decoded, is
 * an RFC 2822 compliant e-mail ready to be sent to an SMTP server. The reason
 * we're using POST instead of GET here is that GET has a max query limit.
 */
app.post('/api/rfc2822', (req, res) => {
	const missingFields = ['threadId', 'body', 'inReplyTo', 'myEmail'].filter((requiredField) => {
		return !req.body[requiredField];
	});
	if (missingFields.length > 0) {
		res.status(400).send(util.format("Must provide %j", missingFields));
		return;
	}
	logger.info(util.format("/api/rfc2822 received for thread %s", req.body.threadId));
	const bodyPlusSignature = req.body.body + "\n\n---\nSent using [Nailbox](https://github.com/NebuPookins/nailbox/).";
	models_thread.get(req.body.threadId).then(thread => {
		if (!thread.message(req.body.inReplyTo)) {
			throw {
				status: 400,
				message: util.format("Could not find message %s in thread %s", req.body.inReplyTo, req.body.threadId)
			};
		}
		return new Promise((resolve, reject) => {
			marked.parse(bodyPlusSignature, {
				gfm: true,
				tables: true, //TODO: This no longer works as of marked 4?
				breaks: true,
				smartLists: true,
				smartypants: true, //smart quotes, dashes, etc.
				highlight: (code, lang) => {
					const htmlWithClasses = lang ?
						hljs.highlight(code, {language: lang, ignoreIllegals: true}).value :
						hljs.highlightAuto(code).value ;
					return posthtml()
						.use((tree) => {
							//Convert HLJS's CSS classes into inline styles.
							for (const [key, value] of Object.entries({
								'hljs-comment': 'color:#586e75',
								'hljs-quote': 'color:#586e75',
								'hljs-addition': 'color:#859900',
								'hljs-keyword': 'color:#859900',
								'hljs-selector-tag': 'color:#859900',
								'hljs-doctag': 'color:#2aa198',
								'hljs-literal'              : 'color:#2aa198',
								'hljs-meta hljs-meta-string': 'color:#2aa198', //TODO
								'hljs-number'               : 'color:#2aa198',
								'hljs-regexp'               : 'color:#2aa198',
								'hljs-string'               : 'color:#2aa198',
								'hljs-name' : 'color:#268bd2',
								'hljs-section' : 'color:#268bd2',
								'hljs-selector-class' : 'color:#268bd2',
								'hljs-selector-id' : 'color:#268bd2',
								'hljs-title' : 'color:#268bd2',
								'hljs-attr' : 'color:#b58900',
								'hljs-attribute' : 'color:#b58900',
								'hljs-class hljs-title' : 'color:#b58900', //TODO
								'hljs-template-variable' : 'color:#b58900',
								'hljs-type' : 'color:#b58900',
								'hljs-variable' : 'color:#b58900',
								'hljs-bullet' : 'color:#cb4b16',
								'hljs-link' : 'color:#cb4b16',
								'hljs-meta' : 'color:#cb4b16',
								'hljs-meta hljs-keyword' : 'color:#cb4b16',
								'hljs-selector-attr' : 'color:#cb4b16',
								'hljs-selector-pseudo' : 'color:#cb4b16',
								'hljs-subst' : 'color:#cb4b16',
								'hljs-symbol' : 'color:#cb4b16',
								'hljs-built_in' : 'color:#dc322f',
								'hljs-deletion' : 'color:#dc322f',
								'hljs-formula' : 'background:#073642',
								'hljs-emphasis' : 'font-style:italic',
								'hljs-strong' : 'font-weight:700',
							})) {
								tree.match({'attrs': { 'class': key}}, (node) => {
									node.attrs.style = value;
									return node;
								});
							}
						})
						.process(htmlWithClasses, {sync: true})
						.html;
				}
			}, (err, content) => {
				if (err) {
					reject(err);
				} else {
					// Add background to pre tag
					const contentWithPreBackground = posthtml()
						.use((tree) => {
							tree.match({'tag':'pre'}, (node) => {
								Object.assign(node, {
									attrs: {
										style: 'background:#002b36; color:#839496'
									}
								});
								return node;
							});
						})
						.process(content, {sync: true})
						.html;
					resolve([thread, contentWithPreBackground]);
				}
			});
		});
	}).then(([thread, htmlizedMarkdown]) => {
		const mostRecentMessage = thread.mostRecentMessageSatisfying(() => true);
		const replyTo = mostRecentMessage.replyTo();
		if (replyTo == null) {
			throw "TODO: How should we handle the case where we can't find a reply to?";
		}
		const threadParticipants = mostRecentMessage.recipients().concat(replyTo);
		if (threadParticipants.some(person => person == null)) {
			logger.warn(`Got null receiver in ${util.inspect(threadParticipants)} from thread ${util.inspect(thread)}`);
		}
		const peopleOtherThanYourself = _.uniqBy(
			threadParticipants
				.filter(person => person != null && person.email !== req.body.myEmail),
			recipient => recipient.email
		);
		const toLine = peopleOtherThanYourself.map(person => util.format("%s <%s>", person.name, person.email));
		const inReplyToId = Optional.ofNullable(mostRecentMessage.header('Message-ID'))
			.map((header) => header.value)
			.orElse(null);
		const mail = mailcomposer({
			from: req.body.myEmail,
			to: toLine,
			inReplyTo: inReplyToId,
			subject: thread.subject(),
			text: bodyPlusSignature,
			html: util.format('<!DOCTYPE html><html><head>'+
				'<style type="test/css">blockquote {padding: 10px 20px;margin: 0 0 20px; border-left: 5px solid #eee;}</style>'+
				'</head><body>%s</body></html>', htmlizedMarkdown)
		});
		return new Promise((resolve, reject) => {
			mail.build((err, message) => {
				if (err) {
					logger.error(util.format("Failed to compose mail %j", err));
					return reject({
						status: 500,
						message: ''
					});
				}
				return resolve(message);
			});
		});
	}).then((resp) => {
		res.status(200).send(base64url.encode(resp));
	}, (failResp) => {
		if (failResp.status && failResp.message) {
			res.status(failResp.status).send(failResp.message);
		} else {
			logger.error(util.inspect(failResp));
			res.sendStatus(500);
		}
	});
});

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
