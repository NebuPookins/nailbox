import fileio from '../../../helpers/fileio.js';
import {createGmailSyncState} from '../services/gmail_sync_service.js';
import type {GmailSyncState, GmailSyncStateRepository, PendingRefresh} from '../services/gmail_sync_service.js';

const GMAIL_SYNC_STATE_PATH = 'data/GmailSyncState.json';

interface GmailSyncStateJson {
	historyId?: string;
	pendingRefreshes?: Record<string, PendingRefresh>;
}

// Persists the Gmail history checkpoint and pending refreshes, so a restart
// resumes with one cheap history.list call instead of a full inbox
// reconciliation, and doesn't forget threads still waiting to be refreshed.
export function createGmailSyncStateRepository(dependencies: {
	fileioImpl?: typeof fileio;
	filePath?: string;
} = {}): GmailSyncStateRepository {
	const {
		fileioImpl = fileio,
		filePath = GMAIL_SYNC_STATE_PATH,
	} = dependencies;

	async function load(): Promise<GmailSyncState> {
		const json = await fileioImpl.readJsonFromOptionalFile(filePath) as GmailSyncStateJson;
		const state = createGmailSyncState();
		if (typeof json.historyId === 'string') {
			state.historyId = json.historyId;
		}
		for (const [threadId, refresh] of Object.entries(json.pendingRefreshes ?? {})) {
			if (Number.isFinite(refresh?.failures) && Number.isFinite(refresh?.retryAt)) {
				state.pendingRefreshes.set(threadId, {failures: refresh.failures, retryAt: refresh.retryAt});
			}
		}
		return state;
	}

	async function save(state: GmailSyncState): Promise<void> {
		const json: GmailSyncStateJson = {
			historyId: state.historyId,
			pendingRefreshes: Object.fromEntries(state.pendingRefreshes),
		};
		await fileioImpl.saveJsonToFile(json, filePath);
	}

	return {load, save};
}
