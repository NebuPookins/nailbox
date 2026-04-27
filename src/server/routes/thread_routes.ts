import util from 'util';

import type {Application, Request, Response} from 'express';

import {getEmailGroupingRules, groupThreads} from '../domain/grouping_rules.js';
import {
	normalizeGroupingRulesConfig,
	normalizeHideUntilDto,
	normalizeWordcountUpdateDto,
} from '../validation/contracts.js';

export default function registerThreadRoutes(app: Application, dependencies: any): void {
	const {
		config,
		configRepository,
		hideUntils,
		lastRefresheds,
		logger,
		threadRepository,
		threadService,
	} = dependencies;

	app.post('/api/threads', async function(req: Request, res: Response) {
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
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.get('/api/threads', async function(req: Request, res: Response) {
		try {
			const formattedThreads = await threadService.getMostRelevantThreads({
				hideUntils,
				limit: 100,
			});
			res.status(200).type('application/json').send(formattedThreads);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.get('/api/email-grouping-rules', function(req: Request, res: Response) {
		try {
			const rules = getEmailGroupingRules(config);
			res.status(200).type('application/json').send(rules);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.post('/api/email-grouping-rules', async function(req: Request, res: Response) {
		try {
			logger.info('Updating email grouping rules');
			config.emailGroupingRules = normalizeGroupingRulesConfig(req.body);
			await configRepository.saveConfig(config);
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

	app.get('/api/threads/grouped', async function(req: Request, res: Response) {
		try {
			const allThreads = await threadService.getMostRelevantThreads({
				hideUntils,
				limit: 100,
			});
			const bundleList = dependencies.bundles ? dependencies.bundles.listBundles() : [];
			const orderedGroupThreads = groupThreads(
				allThreads,
				bundleList,
				getEmailGroupingRules(config),
				hideUntils.comparator(),
			);
			res.status(200).type('application/json').send(orderedGroupThreads);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.delete(/^\/api\/threads\/([a-z0-9]+)$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		logger.info(util.format('Receive request to delete thread %s.', threadId));
		try {
			const isSuccessful = await threadRepository.deleteThread(threadId);
			res.sendStatus(isSuccessful ? 200 : 500);
		} catch (error) {
			logger.error(util.inspect(error));
			res.sendStatus(500);
		}
	});

	app.put(/^\/api\/threads\/([a-z0-9]+)\/hideUntil$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		let hideUntil;
		try {
			hideUntil = normalizeHideUntilDto(req.body);
			switch (hideUntil.type) {
				case 'timestamp': {
					logger.info(`Hiding thread ${threadId} until timestamp ${hideUntil.value}.`);
					await hideUntils.hideUntilTimestamp(threadId, hideUntil.value);
					break;
				}
				case 'when-i-have-time':
					logger.info(`Hiding thread ${threadId} until I have time.`);
					await hideUntils.hideUntilIHaveTime(threadId);
					break;
				default:
					logger.error(`Don't know how to handle hideUntil type: ${JSON.stringify(hideUntil)}`);
					res.status(400).send('Invalid hideUntil.type');
					return;
			}
			res.sendStatus(200);
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: err.message});
				return;
			}
			logger.error(util.format('Failed to save hideUntils: %j', error));
			res.sendStatus(500);
		}
	});

	app.get(/^\/api\/threads\/([a-z0-9]+)\/messages$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		try {
			const result = await threadService.getThreadMessages(threadId);
			res.status(200).send(result.data);
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'ENOENT') {
				res.sendStatus(404);
				return;
			}
			logger.error(util.format('Failed to read thread data: %s', util.inspect(error)));
			res.sendStatus(500);
		}
	});

	app.post(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)\/wordcount$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		const messageId = req.params[1];
		try {
			const {wordcount} = normalizeWordcountUpdateDto(req.body);
			const result = await threadService.updateMessageWordCount({
				threadId,
				messageId,
				wordcount,
			});
			if (result.status === 404) {
				res.sendStatus(404);
				return;
			}
			res.sendStatus(200);
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'INVALID_CONTRACT') {
				res.status(400).send({humanErrorMessage: err.message});
				return;
			}
			if (err.code === 'ENOENT') {
				res.sendStatus(404);
				return;
			}
			logger.error(util.format('Failed to read thread data: %s', util.inspect(error)));
			res.sendStatus(500);
		}
	});

	app.get(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)$/, async function(req: Request, res: Response) {
		const threadId = req.params[0];
		const messageId = req.params[1];
		try {
			const result = await threadService.getThreadMessage(threadId, messageId);
			if (result.status === 404) {
				res.sendStatus(404);
				return;
			}
			res.status(200).send(result.data);
		} catch (error) {
			const err = error as Error & {code?: string};
			if (err.code === 'ENOENT') {
				res.sendStatus(404);
				return;
			}
			logger.error(util.format('Failed to read thread data: %s', util.inspect(error)));
			res.sendStatus(500);
		}
	});
}
