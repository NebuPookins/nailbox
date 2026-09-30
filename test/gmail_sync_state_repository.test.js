import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createGmailSyncStateRepository } from '../src/server/repositories/gmail_sync_state_repository.js';
import { createGmailSyncState } from '../src/server/services/gmail_sync_service.js';

test('gmail sync state round-trips the history checkpoint and pending refreshes', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'nailbox-sync-state-'));
	try {
		const repository = createGmailSyncStateRepository({ filePath: path.join(directory, 'GmailSyncState.json') });
		const state = createGmailSyncState();
		state.historyId = '42';
		state.pendingRefreshes.set('18c2f0a1b2c3d4e5', { failures: 2, retryAt: 1000 });

		await repository.save(state);

		assert.deepEqual(await repository.load(), state);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('gmail sync state starts empty without a file and skips malformed pending entries', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'nailbox-sync-state-'));
	try {
		const filePath = path.join(directory, 'GmailSyncState.json');
		const repository = createGmailSyncStateRepository({ filePath });
		assert.deepEqual(await repository.load(), createGmailSyncState());

		await writeFile(filePath, JSON.stringify({
			historyId: 7,
			pendingRefreshes: { good: { failures: 1, retryAt: 5 }, bad: { failures: 'x' }, worse: null },
		}));
		const loaded = await repository.load();
		assert.equal(loaded.historyId, undefined);
		assert.deepEqual([...loaded.pendingRefreshes], [['good', { failures: 1, retryAt: 5 }]]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
