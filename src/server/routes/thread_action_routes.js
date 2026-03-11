import util from 'util';

import _ from 'lodash';

import defaultThreadRepository from '../repositories/thread_repository.js';
import { buildRfc2822Message } from '../services/rfc2822_service.js';
import { refreshSingleThreadFromGmail, syncRecentThreadsFromGmail } from '../services/gmail_sync_service.js';
import {
	normalizeGmailMoveThreadDto,
	normalizeGmailSendMessageDto,
	normalizeRfc2822RequestDto,
} from '../validation/contracts.js';

export default function registerThreadActionRoutes(app, dependencies) {
	const {
		lastRefresheds,
		logger,
		threadRepository = defaultThreadRepository,
		withGmailApi,
	} = dependencies;

	app.get('/api/threads/profile', async function(req, res) {
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

	app.get('/api/threads/labels', async function(req, res) {
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

	app.post('/api/threads/sync', async function(req, res) {
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

	app.post(/^\/api\/threads\/([a-z0-9]+)\/refresh$/, async function(req, res) {
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
		try {
			const { labelId } = normalizeGmailMoveThreadDto(req.body);
			const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
				return gmailRequest({
					method: 'POST',
					path: `/threads/${threadId}/modify`,
					json: {
						removeLabelIds: ['INBOX', 'UNREAD'],
						addLabelIds: [labelId],
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
			if (error.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: error.message});
				return;
			}
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post('/api/threads/messages/send', async function(req, res) {
		try {
			const messagePayload = normalizeGmailSendMessageDto(req.body);
			const gmailResponse = await withGmailApi(res, async (gmailRequest) => {
				return gmailRequest({
					method: 'POST',
					path: '/messages/send',
					json: messagePayload,
				});
			});
			if (gmailResponse == null) {
				return;
			}
			res.status(200).send(gmailResponse);
		} catch (error) {
			if (error.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: error.message});
				return;
			}
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.get(/^\/api\/threads\/messages\/([a-z0-9]+)\/attachments\/([a-zA-Z0-9_-]+)$/, async function(req, res) {
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
		try {
			const requestDto = normalizeRfc2822RequestDto(req.body);
			logger.info(util.format('/api/rfc2822 received for thread %s', requestDto.threadId));
			const encodedMessage = await buildRfc2822Message({
				threadId: requestDto.threadId,
				body: requestDto.body,
				inReplyTo: requestDto.inReplyTo,
				myEmail: requestDto.myEmail,
				logger,
			});
			res.status(200).send(encodedMessage);
		} catch (error) {
			if (error.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: error.message});
				return;
			}
			if (error.status && error.message) {
				res.status(error.status).send(error.message);
				return;
			}
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

}
