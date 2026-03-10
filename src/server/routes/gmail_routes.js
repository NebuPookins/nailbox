import util from 'util';

import _ from 'lodash';

import threadRepository from '../repositories/thread_repository.js';
import { buildRfc2822Message } from '../services/rfc2822_service.js';
import { refreshSingleThreadFromGmail, syncRecentThreadsFromGmail } from '../services/gmail_sync_service.js';

export default function registerGmailRoutes(app, dependencies) {
	const {lastRefresheds, logger, withGmailApi} = dependencies;

	app.get('/api/gmail/profile', async function(req, res) {
		try {
			const profile = await withGmailApi(res, async (gmailRequest) => {
				return gmailRequest({
					path: '/profile',
				});
			});
			if (profile == null) {
				return;
			}
			res.status(200).send(profile);
		} catch (error) {
			logger.error(util.inspect(error));
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
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post('/api/gmail/sync', async function(req, res) {
		try {
			const syncResult = await withGmailApi(res, async (gmailRequest) => {
				return syncRecentThreadsFromGmail({
					gmailRequest,
					lastRefresheds,
				});
			});
			if (syncResult == null) {
				return;
			}
			res.status(200).send({
				syncedThreadCount: syncResult.threadIds.length,
				results: syncResult.results,
			});
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post(/^\/api\/gmail\/threads\/([a-z0-9]+)\/refresh$/, async function(req, res) {
		const threadId = req.params[0];
		try {
			const refreshResult = await withGmailApi(res, async (gmailRequest) => {
				return refreshSingleThreadFromGmail({
					gmailRequest,
					threadId,
					lastRefresheds,
				});
			});
			if (refreshResult == null) {
				return;
			}
			res.sendStatus(refreshResult.status);
		} catch (error) {
			logger.error(util.inspect(error));
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
		} catch (error) {
			logger.error(util.inspect(error));
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
		} catch (error) {
			logger.error(util.inspect(error));
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
		} catch (error) {
			logger.error(util.inspect(error));
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
		} catch (error) {
			logger.error(util.inspect(error));
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
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post('/api/rfc2822', async function(req, res) {
		const missingFields = ['threadId', 'body', 'inReplyTo', 'myEmail'].filter((requiredField) => {
			return !req.body[requiredField];
		});
		if (missingFields.length > 0) {
			res.status(400).send(util.format('Must provide %j', missingFields));
			return;
		}
		logger.info(util.format('/api/rfc2822 received for thread %s', req.body.threadId));
		try {
			const encodedMessage = await buildRfc2822Message({
				threadId: req.body.threadId,
				body: req.body.body,
				inReplyTo: req.body.inReplyTo,
				myEmail: req.body.myEmail,
				logger,
			});
			res.status(200).send(encodedMessage);
		} catch (error) {
			if (error.status && error.message) {
				res.status(error.status).send(error.message);
				return;
			}
			logger.error(util.inspect(error));
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
				return;
			}
			res.sendStatus(500);
		} catch (error) {
			logger.error(util.inspect(error));
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
				return;
			}
			res.sendStatus(500);
		} catch (error) {
			logger.error(util.inspect(error));
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
				return;
			}
			res.sendStatus(500);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});
}
