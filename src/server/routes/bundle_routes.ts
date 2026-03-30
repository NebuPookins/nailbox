import util from 'util';

import type {Application, Request, Response} from 'express';

import {normalizeHideUntilDto} from '../validation/contracts.js';

export default function registerBundleRoutes(app: Application, dependencies: any): void {
	const {
		bundles,
		hideUntils,
		logger,
		threadRepository,
		withGmailApi,
	} = dependencies;

	app.get('/api/bundles', function(req: Request, res: Response) {
		try {
			res.status(200).type('application/json').send(bundles.listBundles());
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post('/api/bundles', async function(req: Request, res: Response) {
		try {
			const body = req.body;
			if (!body || !Array.isArray(body.threadIds) || body.threadIds.length < 2) {
				res.status(400).send({humanErrorMessage: 'threadIds must be an array of at least 2 thread IDs.'});
				return;
			}
			const threadIds: string[] = body.threadIds;
			if (!threadIds.every((id) => typeof id === 'string')) {
				res.status(400).send({humanErrorMessage: 'All threadIds must be strings.'});
				return;
			}
			// Check that none of the threadIds are already in a bundle
			for (const threadId of threadIds) {
				if (bundles.getBundleForThread(threadId)) {
					res.status(409).send({humanErrorMessage: `Thread ${threadId} is already in a bundle.`});
					return;
				}
			}
			const bundleId = bundles.createBundle(threadIds);
			await bundles.save();
			logger.info(`Created bundle ${bundleId} with threads: ${threadIds.join(', ')}`);
			res.status(201).type('application/json').send({bundleId});
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.put('/api/bundles/:bundleId', async function(req: Request, res: Response) {
		const {bundleId} = req.params;
		try {
			const bundle = bundles.getBundle(bundleId);
			if (!bundle) {
				res.sendStatus(404);
				return;
			}
			const body = req.body;
			if (!body || !Array.isArray(body.threadIds) || body.threadIds.length < 2) {
				res.status(400).send({humanErrorMessage: 'threadIds must be an array of at least 2 thread IDs.'});
				return;
			}
			const threadIds: string[] = body.threadIds;
			if (!threadIds.every((id) => typeof id === 'string')) {
				res.status(400).send({humanErrorMessage: 'All threadIds must be strings.'});
				return;
			}
			// Only check newly added threads for conflicts with OTHER bundles
			for (const threadId of threadIds) {
				if (!bundle.threadIds.includes(threadId)) {
					const existing = bundles.getBundleForThread(threadId);
					if (existing && existing.bundleId !== bundleId) {
						res.status(409).send({humanErrorMessage: `Thread ${threadId} is already in another bundle.`});
						return;
					}
				}
			}
			bundles.updateBundle(bundleId, threadIds);
			await bundles.save();
			logger.info(`Updated bundle ${bundleId} threadIds.`);
			res.sendStatus(200);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.delete('/api/bundles/:bundleId', async function(req: Request, res: Response) {
		const {bundleId} = req.params;
		try {
			const bundle = bundles.getBundle(bundleId);
			if (!bundle) {
				res.sendStatus(404);
				return;
			}
			bundles.deleteBundle(bundleId);
			await bundles.save();
			logger.info(`Dissolved bundle ${bundleId}.`);
			res.sendStatus(204);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.put('/api/bundles/:bundleId/hideUntil', async function(req: Request, res: Response) {
		const {bundleId} = req.params;
		try {
			const bundle = bundles.getBundle(bundleId);
			if (!bundle) {
				res.sendStatus(404);
				return;
			}
			const hideUntil = normalizeHideUntilDto(req.body);
			await Promise.all(bundle.threadIds.map((threadId: string) => {
				switch (hideUntil.type) {
					case 'timestamp':
						logger.info(`Hiding thread ${threadId} (bundle ${bundleId}) until timestamp ${hideUntil.value}.`);
						return hideUntils.hideUntilTimestamp(threadId, hideUntil.value);
					case 'when-i-have-time':
						logger.info(`Hiding thread ${threadId} (bundle ${bundleId}) until I have time.`);
						return hideUntils.hideUntilIHaveTime(threadId);
					default:
						return Promise.resolve();
				}
			}));
			res.sendStatus(200);
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

	app.post('/api/bundles/:bundleId/archive', async function(req: Request, res: Response) {
		const {bundleId} = req.params;
		try {
			const bundle = bundles.getBundle(bundleId);
			if (!bundle) {
				res.sendStatus(404);
				return;
			}
			const gmailResult = await withGmailApi(res, async (gmailRequest: any) => {
				await Promise.all(bundle.threadIds.map((threadId: string) => {
					logger.info(`Archiving thread ${threadId} (bundle ${bundleId}).`);
					return gmailRequest({
						method: 'POST',
						path: `/threads/${threadId}/modify`,
						json: {removeLabelIds: ['INBOX']},
					});
				}));
				return true;
			});
			if (gmailResult == null) {
				return;
			}
			await Promise.all(bundle.threadIds.map((threadId: string) =>
				threadRepository.deleteThread(threadId)
			));
			bundles.deleteBundle(bundleId);
			await bundles.save();
			res.sendStatus(200);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});
}
