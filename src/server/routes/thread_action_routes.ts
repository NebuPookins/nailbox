import util from 'util';

import _ from 'lodash';

import type {Application, Request, Response} from 'express';

import {refreshSingleThreadFromGmail, syncRecentThreadsFromGmail} from '../services/gmail_sync_service.js';
import {
	normalizeGmailMoveThreadDto,
	normalizeGmailSendMessageDto,
	normalizeRfc2822RequestDto,
} from '../validation/contracts.js';

export default function registerThreadActionRoutes(app: Application, dependencies: any): void {
	const {
		bundles,
		lastRefresheds,
		logger,
		notifyThreadsChanged,
		rfc2822Service,
		threadRepository,
		threadService,
		withGmailApi,
	} = dependencies;

	async function cleanupBundleAfterThreadDeletion(threadId: string): Promise<void> {
		const bundle = bundles?.getBundleForThread(threadId);
		if (!bundle) return;
		const remainingThreadIds = bundle.threadIds.filter((id: string) => id !== threadId);
		if (remainingThreadIds.length < 2) {
			bundles.deleteBundle(bundle.bundleId);
		} else {
			bundles.updateBundle(bundle.bundleId, remainingThreadIds);
		}
		await bundles.save();
	}

	app.get('/api/threads/profile', async function(req: Request, res: Response) {
		try {
			const profile = await withGmailApi(res, async (gmailRequest: any) => {
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

	app.get('/api/threads/labels', async function(req: Request, res: Response) {
		try {
			const labelsResponse = await withGmailApi(res, async (gmailRequest: any) => {
				return gmailRequest({
					path: '/labels',
				});
			});
			if (labelsResponse == null) {
				return;
			}
			const labels = Array.isArray(labelsResponse.labels) ? labelsResponse.labels : [];
			res.status(200).send(_.sortBy(labels, function(label: any) {
				return (label.type === 'system' ? 'A' : 'B') + label.name.toLowerCase();
			}));
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post('/api/threads/sync', async function(req: Request, res: Response) {
		try {
			const syncResult = await withGmailApi(res, async (gmailRequest: any) => {
				return syncRecentThreadsFromGmail({
					gmailRequest,
					lastRefresheds,
					threadRepository,
					threadService,
				});
			});
			if (syncResult == null) {
				return;
			}
			if (Array.isArray(syncResult.changedThreadIds) && syncResult.changedThreadIds.length > 0) {
				notifyThreadsChanged?.('manual-sync');
			}
			res.status(200).send({
				changedThreadCount: syncResult.changedThreadIds.length,
				syncedThreadCount: syncResult.threadIds.length,
				results: syncResult.results,
			});
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post(/^\/api\/threads\/([a-z0-9]+)\/refresh$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		try {
			const refreshResult = await withGmailApi(res, async (gmailRequest: any) => {
				return refreshSingleThreadFromGmail({
					gmailRequest,
					threadId,
					lastRefresheds,
					threadRepository,
					threadService,
				});
			});
			if (refreshResult == null) {
				return;
			}
			if (refreshResult.changed) {
				notifyThreadsChanged?.('thread-refresh');
			}
			res.sendStatus(refreshResult.status);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post(/^\/api\/threads\/([a-z0-9]+)\/trash$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		try {
			const gmailResponse = await withGmailApi(res, async (gmailRequest: any) => {
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
				await cleanupBundleAfterThreadDeletion(threadId);
				res.status(200).send(gmailResponse);
				return;
			}
			res.sendStatus(500);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post(/^\/api\/threads\/([a-z0-9]+)\/archive$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		try {
			const gmailResponse = await withGmailApi(res, async (gmailRequest: any) => {
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
				await cleanupBundleAfterThreadDeletion(threadId);
				res.status(200).send(gmailResponse);
				return;
			}
			res.sendStatus(500);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post(/^\/api\/threads\/([a-z0-9]+)\/move$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		try {
			const {labelId} = normalizeGmailMoveThreadDto(req.body);
			const gmailResponse = await withGmailApi(res, async (gmailRequest: any) => {
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
				await cleanupBundleAfterThreadDeletion(threadId);
				res.status(200).send(gmailResponse);
				return;
			}
			res.sendStatus(500);
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: err.message});
				return;
			}
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post('/api/threads/messages/send', async function(req: Request, res: Response) {
		try {
			const messagePayload = normalizeGmailSendMessageDto(req.body);
			const gmailResponse = await withGmailApi(res, async (gmailRequest: any) => {
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
			const err = error as Error & {code?: string};
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: err.message});
				return;
			}
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.get(/^\/api\/threads\/messages\/([a-z0-9]+)\/attachments\/([a-zA-Z0-9_-]+)$/, async function(req: Request, res: Response) {
		const messageId = req.params[0];
		const attachmentId = req.params[1];
		try {
			const attachment = await withGmailApi(res, async (gmailRequest: any) => {
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

	app.post('/api/rfc2822', async function(req: Request, res: Response) {
		try {
			const requestDto = normalizeRfc2822RequestDto(req.body);
			logger.info(util.format('/api/rfc2822 received for thread %s', requestDto.threadId));
			const encodedMessage = await rfc2822Service.buildRfc2822Message({
				threadId: requestDto.threadId,
				body: requestDto.body,
				inReplyTo: requestDto.inReplyTo,
				myEmail: requestDto.myEmail,
				logger,
			});
			res.status(200).send(encodedMessage);
		} catch (error) {
			const err = error as Error & {code?: string; status?: number; message: string};
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: err.message});
				return;
			}
			if (err.status && err.message) {
				res.status(err.status).send(err.message);
				return;
			}
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});
}
