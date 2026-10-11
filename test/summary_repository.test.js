import test from 'node:test';
import assert from 'node:assert/strict';

import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {createSummaryRepository} from '../src/server/repositories/summary_repository.js';

test('summary repository round-trips a per-message summary', async () => {
	const summariesDirectory = await mkdtemp(path.join(tmpdir(), 'nailbox-summaries-'));
	try {
		const repository = createSummaryRepository({summariesDirectory});
		const summary = {messageId: 'm1', summary: 'Action: Reply.', createdAt: '2026-10-11T00:00:00.000Z', model: 'claude-haiku-5-5'};
		await repository.saveSummary(summary);
		assert.deepEqual(await repository.readSummary('m1'), summary);
		assert.equal(await repository.readSummary('missing'), null);
	} finally {
		await rm(summariesDirectory, {recursive: true, force: true});
	}
});
