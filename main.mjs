const DEFAULT_CONFIG = {
	port: 3000
};
const PATH_TO_CONFIG = 'data/config.json';

import assert from 'assert';
import util from 'util';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import crypto from 'node:crypto';
import nebulog from 'nebulog';
const logger = nebulog.make({filename: 'main.mjs', level: 'debug'});
import nodeFs from 'node-fs';
import nodeFsPromises from 'node:fs/promises';
import q from 'q';
import _ from 'lodash';
import sanitizeHtml from 'sanitize-html';
import htmlEntities from 'html-entities';
const Entities = htmlEntities.AllHtmlEntities;
const entities = new Entities();
import mailcomposer from 'mailcomposer';
import { marked } from 'marked';
import base64url from 'base64url';
import hljs from 'highlight.js';
import posthtml from 'posthtml';
import Optional from 'optional-js';
import helpers_fileio from './helpers/fileio.js';

import models_thread from './models/thread.js';
import models_message from './models/message.js';
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
const [config, hideUntils, lastRefresheds] = await Promise.all([
	helpers_fileio.readJsonFromOptionalFile(PATH_TO_CONFIG),
	models_hideUntils.load(),
	models_lastRefreshed.load(),
]);

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
	}).done();
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
	}).done();
});

/**
 * @param threadId [String] the thread to delete
 * @param resultCallback [function] Callback function receive a boolean. True
 * indicates that the deletion was successful, false indicates the deletion was
 * unsuccessful.
 */
function deleteThread(threadId, resultCallback) {
	const pathToDelete = 'data/threads/' + threadId;
	nodeFs.unlink(pathToDelete, function(err) {
		if (err) {
			if (err.code === 'ENOENT') {
				//Files is already deleted; that's okay, delete is idempotent.
				logger.info(`File ${pathToDelete} already deleted.`);
				resultCallback(true);
			} else {
				logger.error(util.format("Error deleting %s. Code: %s. Stack: %s",
					pathToDelete, err.code, err.stack));
				resultCallback(false);
			}
		} else {
			logger.info(util.format("Deleted file %s", pathToDelete));
			resultCallback(true);
		}
	});
}

/**
 * Records the existence of a thread. The client-side code periodically checks
 * gmail for the 100 most recent threads, and performs a POST to this route
 * to inform the backend the contents of those threads.
 */
async function saveThreadPayload(threadPayload) {
	const threadId = threadPayload.id;
	if (typeof threadId === 'string' && threadId.match(/^[0-9a-z]+$/)) {
		const allMessagesInTrash = threadPayload.messages.every(
			(message) => message.labelIds.indexOf('TRASH') !== -1
		);
		if (allMessagesInTrash) {
			logger.info(`Deleting thread ${threadId} because all messages in thread are in trash.`);
			return await new Promise((resolve) => {
				deleteThread(threadId, function(isSuccessful) {
					resolve({
						status: isSuccessful ? 200 : 500,
					});
				});
			});
		} else {
			// Calculate wordCount and timeToReadSeconds for each message
			threadPayload.messages.forEach(messageData => {
				const messageInstance = new models_message.Message(messageData);
				const originalBody = messageInstance.bestBody();
				const plainTextBody = sanitizeHtml(originalBody, { allowedTags: [], allowedAttributes: {} });
				const wordCount = plainTextBody.split(' ').filter(word => word.length > 0).length;
				const timeToReadSeconds = Math.round((wordCount * 60) / 200);
				messageData.calculatedWordCount = wordCount;
				messageData.calculatedTimeToReadSeconds = timeToReadSeconds;
			});

			const filePath = 'data/threads/' + threadId;
			const existingData = await helpers_fileio.readJsonFromOptionalFile(filePath);
			const newData = threadPayload;
			if (existingData && existingData.messages) {
				newData.messages.forEach(newMessage => {
					const existingMessage = existingData.messages.find(m => m.id === newMessage.id);
					if (existingMessage && existingMessage.fullBodyWordCount) {
						newMessage.fullBodyWordCount = existingMessage.fullBodyWordCount;
					}
				});
			}
			await new Promise((resolve, reject) => {
				nodeFs.writeFile(filePath, JSON.stringify(newData), function(err) {
					if (err) {
						logger.error(util.inspect(err));
						reject(err);
					} else {
						lastRefresheds.markRefreshed(threadId).done();
						resolve();
					}
				});
			});
			return {status: 200};
		}
	} else {
		return {
			status: 400,
			body: { humanErrorMessage: "invalid threadId" },
		};
	}
}

app.post('/api/threads', async function(req, res) {
	try {
		const result = await saveThreadPayload(req.body);
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
		return saveThreadPayload(gmailThread);
	} catch (error) {
		if (error.status === 404) {
			return await new Promise((resolve) => {
				deleteThread(threadId, function(isSuccessful) {
					resolve({status: isSuccessful ? 200 : 500});
				});
			});
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
		deleteThread(threadId, function(isSuccessful) {
			if (isSuccessful) {
				res.status(200).send(gmailResponse);
			} else {
				res.sendStatus(500);
			}
		});
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
		deleteThread(threadId, function(isSuccessful) {
			if (isSuccessful) {
				res.status(200).send(gmailResponse);
			} else {
				res.sendStatus(500);
			}
		});
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
		deleteThread(threadId, function(isSuccessful) {
			if (isSuccessful) {
				res.status(200).send(gmailResponse);
			} else {
				res.sendStatus(500);
			}
		});
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
async function getNMostRelevantThreads(n) {
	const filenames = await nodeFsPromises.readdir('data/threads');
	const now = Date.now();
	let formattedThreads = await Promise.all(filenames.map(async (filename) => {
		try {
			const thread = await models_thread.get(filename);
			const maybeMostRecentSnippetInThread = thread.snippet();
			assert((typeof thread.id()) === 'string', `Expected thread.id() to be a string but was ${typeof thread.threadId} for file ${filename}.`);

			let totalTimeToReadSecondsForThread = 0;
			const messagesInThread = thread.messages();
			messagesInThread.forEach(message => {
				totalTimeToReadSecondsForThread += message.getBestReadTimeSeconds();
			});

			let recentMessageReadTime = 0;
			if (messagesInThread && messagesInThread.length > 0) {
				let mostRecentMessage = messagesInThread[0];
				for (let i = 1; i < messagesInThread.length; i++) {
					if (parseInt(messagesInThread[i].getInternalDate(), 10) > parseInt(mostRecentMessage.getInternalDate(), 10)) {
						mostRecentMessage = messagesInThread[i];
					}
				}
				if (mostRecentMessage) {
					recentMessageReadTime = mostRecentMessage.getBestReadTimeSeconds();
				}
			}

			return {
				threadId: thread.id(),
				senders: thread.senders(),
				receivers: thread.recipients(),
				lastUpdated: thread.lastUpdated(),
				subject: thread.subject(),
				snippet: maybeMostRecentSnippetInThread ? entities.decode(maybeMostRecentSnippetInThread) : null,
				messageIds: thread.messageIds(),
				labelIds: thread.labelIds(),
				visibility: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).getVisibility(thread.lastUpdated(), now),
				isWhenIHaveTime: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).isWhenIHaveTime(),
				needsRefreshing: lastRefresheds.needsRefreshing(thread.id(), thread.lastUpdated(), now),
				totalTimeToReadSeconds: totalTimeToReadSecondsForThread,
				recentMessageReadTimeSeconds: recentMessageReadTime,
			};
		} catch (e) {
			logger.warn("Couldn't read certain threads in getNMostrElevantThreads. Ignoring and continuing. ", util.inspect(e));
			return null;
		}
	}));
	formattedThreads = formattedThreads
		.filter(formattedThread => formattedThread !== null)
		.filter(formattedThread => formattedThread.visibility !== 'hidden');
	formattedThreads.sort(hideUntils.comparator());
	formattedThreads.length = Math.min(formattedThreads.length, 100);
	return formattedThreads;
}

/**
 * Replies with a list of threads to show on the main page.
 */
app.get('/api/threads', async function(req, res) {
	try {
		const formattedThreads = await getNMostRelevantThreads(100);
		res.status(200);
		res.type('application/json');
		res.send(formattedThreads);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

/**
 * Get email grouping rules from config
 */
function getEmailGroupingRules(config) {
	if (!config.emailGroupingRules) {
		return { rules: [] };
	}
	return config.emailGroupingRules;
}

/**
 * Check if a thread matches a grouping rule
 */
function threadMatchesRule(thread, rule) {
	return rule.conditions.some(condition => {
		switch (condition.type) {
			case 'sender_name':
				return thread.senders.some(sender => 
					sender.name && sender.name.includes(condition.value)
				);
			case 'sender_email':
				return thread.senders.some(sender => 
					sender.email && sender.email.includes(condition.value)
				);
			case 'subject':
				return thread.subject && thread.subject.includes(condition.value);
			default:
				return false;
		}
	});
}

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
		config.emailGroupingRules = req.body;
		helpers_fileio.saveJsonToFile(config, PATH_TO_CONFIG).then(function() {
			res.sendStatus(200);
		}, function(err) {
			logger.error(util.format("Failed to save config file: %s", util.inspect(err)));
			res.sendStatus(500);
		}).done();
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
		const allThreads = await getNMostRelevantThreads(100);
		var groupedThreads = {};
		const whenIHaveTimeSuffix = " - When I Have Time";
		
		// Get grouping rules from config
		const groupingRules = getEmailGroupingRules(config);

		function addToGroupedThreads(group, thread) {
			const key = (thread.visibility === 'when-i-have-time') ? `${group}${whenIHaveTimeSuffix}` : group;
			if (!Array.isArray(groupedThreads[key])) {
				groupedThreads[key] = [];
			}
			groupedThreads[key].push(thread);
		}

		allThreads.forEach((thread) => {
			var foundAGroup = false;
			for (let rule of groupingRules.rules) {
				if (threadMatchesRule(thread, rule)) {
					addToGroupedThreads(rule.name, thread);
					foundAGroup = true;
					break;
				}
			}
			if (!foundAGroup) {
				addToGroupedThreads("Others", thread);
			}
		});

		var orderedGroupThreads = [];
		Object.keys(groupedThreads).forEach((group) => {
			// Find the rule that created this group to get its sortType
			let sortType = "mostRecent"; // default
			for (let rule of groupingRules.rules) {
				if (rule.name === group || group.endsWith(whenIHaveTimeSuffix) && rule.name === group.replace(whenIHaveTimeSuffix, "")) {
					sortType = rule.sortType || "mostRecent";
					break;
				}
			}
			
			// Sort threads within the group based on sortType
			let sortedThreads = [...groupedThreads[group]];
			if (sortType === "shortest") {
				sortedThreads.sort((a, b) => {
					// Sort by total word count (ascending - shortest first)
					return a.totalTimeToReadSeconds - b.totalTimeToReadSeconds;
				});
			} else {
				// Default "mostRecent" sorting
				const hideUntilComparator = hideUntils.comparator();
				sortedThreads.sort(hideUntilComparator);
			}
			
			orderedGroupThreads.push({
				label: group,
				threads: sortedThreads,
				sortType: sortType
			});
		});

		/*
			* Sort groups by their "newest" message; threads is guaranteed non-empty
			* from previous step.
			*/
		const hideUntilComparator = hideUntils.comparator();
		orderedGroupThreads.sort((groupA, groupB) => {
			return hideUntilComparator(groupA.threads[0], groupB.threads[0]);
		});
		
		// Create priority map from rules
		const groupPriority = {};
		groupingRules.rules.forEach(rule => {
			groupPriority[rule.name] = rule.priority;
		});
		
		orderedGroupThreads.sort((groupA, groupB) => {
			const BFirst = 1;
			const AFirst = -1;
			let labelA = groupA.label.replace(whenIHaveTimeSuffix, "");
			let labelB = groupB.label.replace(whenIHaveTimeSuffix, "");
			let whenIHaveTimeA = labelA != groupA.label;
			let whenIHaveTimeB = labelB != groupB.label;
			if (whenIHaveTimeA && !whenIHaveTimeB) {
				return BFirst;
			}
			if (!whenIHaveTimeA && whenIHaveTimeB) {
				return AFirst;
			}
			//assert whenIHaveTimeA == whenIHaveTimeB;
			if (groupPriority[labelA]) {
				if (groupPriority[labelB]) {
					return groupPriority[labelA] - groupPriority[labelB];
				} else {
					return BFirst;
				}
			} else {
				if (groupPriority[labelB]) {
					return AFirst;
				} else {
					return 0;
				}
			}
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
	deleteThread(threadId, function(isSuccessful) {
		res.sendStatus(isSuccessful ? 200 : 500);
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

function loadRelevantDataFromMessage(objMessage) {
	const originalBody = objMessage.bestBody();
	const attachments = objMessage.getAttachments();
	const plainTextBody = sanitizeHtml(originalBody, {
		allowedTags: [],
		allowedAttributes: {}
	});
	const wordCount = plainTextBody.split(' ').length;
	const timeToReadSeconds = wordCount * 60 / 200;
	const sanitizedBody = sanitizeHtml(originalBody, {
		transformTags: {
			'body': 'div',
			'a': function(tagName, attribs) {
				//All links in messages should open in a new tab.
				if (attribs.href) {
					attribs.target = '_blank';
				}
				return {
					tagName: 'a',
					attribs: attribs
				};
			},
			'*': function(tagName, attribs) {
				if ((typeof attribs.style) === 'string') {
					attribs.style = attribs.style.replace(/position: *absolute;/, '');
					return {
						tagName: tagName,
						attribs: attribs
					};
				} else {
					return {
						tagName: tagName,
						attribs: attribs
					};
				}
			}
		},
		allowedTags: [
			"a", "area", "b", "blockquote", "br", "caption", "center", "code",
			"div", "em",
			"h1", "h2", "h3", "h4", "h5", "h6",
			"hr", "i", "img", "li", "map", "nl", "ol", "p", "pre", 'span',
			"strike", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"],
		allowedAttributes: {
			a: [ 'href', 'name', 'style', 'target' ],
			area: ['href', 'shape', 'coords', 'style', 'target'],
			div: ['style'],
			img: [ 'alt', 'border', 'height', 'src', 'style', 'usemap', 'width' ],
			map: ['name'],
			p: ['style'],
			span: ['style'],
			table: ['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'style', 'width'],
			td: ['align', 'background', 'bgcolor', 'colspan', 'height', 'rowspan', 'style', 'valign', 'width'],
		},
		nonTextTags: [ 'style', 'script', 'textarea', 'title' ]
	});
	return {
		deleted: objMessage.labelIds().indexOf('TRASH') !== -1,
		messageId: objMessage.id(),
		from: [objMessage.sender()], //TODO: Fix contract so this is no longer an array
		to: objMessage.recipients(),
		date: objMessage.timestamp(),
		body: {
			original: originalBody,
			sanitized: sanitizedBody,
			plainText: plainTextBody,
		},
		wordcount: plainTextBody.split(' ').length,
		timeToReadSeconds: timeToReadSeconds,
		attachments: attachments
	};
}

app.get(/^\/api\/threads\/([a-z0-9]+)\/messages$/, function(req, res) {
	const threadId = req.params[0];
	models_thread.get(threadId).then(function(thread) {
		res.status(200).send({
			messages: thread.messages().map(loadRelevantDataFromMessage)
		});
	}, function(err) {
		if (err.code === 'ENOENT') {
			res.sendStatus(404);
		} else {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}
	}).done();
});


app.post(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)\/wordcount$/, function(req, res) {
	const threadId = req.params[0];
	const messageId = req.params[1];
	const wordcount = req.body.wordcount;
	if (typeof wordcount !== 'string' && typeof wordcount !== 'number') {
		res.status(400).send({ humanErrorMessage: "invalid wordcount" });
		return;
	}
	models_thread.get(threadId).then(async function(thread) {
		const message = thread.message(messageId);
		if (message) {
			message._data.fullBodyWordCount = parseInt(wordcount);
			try {
				await helpers_fileio.saveJsonToFile(thread._data, 'data/threads/' + threadId);
				res.sendStatus(200);
			} catch (err) {
				logger.error(`Failed to save thread data with word count: ${err}`);
				res.sendStatus(500);
			}
		} else {
			res.sendStatus(404);
		}
	}, function(err) {
		if (err.code === 'ENOENT') {
			res.sendStatus(404);
		} else {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}
	}).done();
});

app.get(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)$/, function(req, res) {
	const threadId = req.params[0];
	const messageId = req.params[1];
	models_thread.get(threadId).then(function(thread) {
		const matchingMessage = thread.message(messageId);
		if (matchingMessage) {
			res.status(200).send(loadRelevantDataFromMessage(matchingMessage));
		} else {
			res.sendStatus(404);
		}
	}, function(err) {
		if (err.code === 'ENOENT') {
			res.sendStatus(404);
		} else {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}
	}).done();
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
		return q.Promise((resolve, reject) => {
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
	}).spread((thread, htmlizedMarkdown) => {
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
		return q.Promise((resolve, reject) => {
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
	}).done();
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
