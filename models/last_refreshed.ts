import assert from 'assert';

import nebulog from 'nebulog';

import fileio from '../helpers/fileio.js';

const PATH_TO_LAST_REFRESHED = 'data/LastRefreshed.json';
const logger = nebulog.make({filename: 'models/last_refreshed.ts', level: 'debug'});
const DEFAULT_FLUSH_DELAY_MS = 100;

type LastRefreshedJsonData = Record<string, number>;
type SaveJsonToFile = (json: unknown, filePath: string) => Promise<unknown>;
type ScheduleFlush = (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
type ClearScheduledFlush = (handle: ReturnType<typeof setTimeout>) => void;

interface LastRefreshedOptions {
	flushDelayMs?: number;
	saveJsonToFile?: SaveJsonToFile;
	scheduleFlush?: ScheduleFlush;
	clearScheduledFlush?: ClearScheduledFlush;
}

/**
 * @param jsonData [Hash]
 */
export class LastRefreshedData {
	private _jsonData: LastRefreshedJsonData;
	private _flushDelayMs: number;
	private _saveJsonToFile: SaveJsonToFile;
	private _scheduleFlush: ScheduleFlush;
	private _clearScheduledFlush: ClearScheduledFlush;
	private _scheduledFlushHandle: ReturnType<typeof setTimeout> | null;
	private _currentFlushPromise: Promise<void> | null;
	private _resolveCurrentFlushPromise: (() => void) | null;
	private _rejectCurrentFlushPromise: ((error: unknown) => void) | null;
	private _dirty: boolean;
	private _isFlushInProgress: boolean;

	constructor(jsonData: LastRefreshedJsonData, options: LastRefreshedOptions = {}) {
		this._jsonData = jsonData;
		this._flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
		this._saveJsonToFile = options.saveJsonToFile ?? fileio.saveJsonToFile;
		this._scheduleFlush = options.scheduleFlush ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this._clearScheduledFlush = options.clearScheduledFlush ?? clearTimeout;
		this._scheduledFlushHandle = null;
		this._currentFlushPromise = null;
		this._resolveCurrentFlushPromise = null;
		this._rejectCurrentFlushPromise = null;
		this._dirty = false;
		this._isFlushInProgress = false;
	}

	private _ensureFlushPromise(): Promise<void> {
		if (!this._currentFlushPromise) {
			this._currentFlushPromise = new Promise((resolve, reject) => {
				this._resolveCurrentFlushPromise = resolve;
				this._rejectCurrentFlushPromise = reject;
			});
		}
		return this._currentFlushPromise;
	}

	private _finishFlushPromise(error: unknown): void {
		const resolve = this._resolveCurrentFlushPromise;
		const reject = this._rejectCurrentFlushPromise;
		this._currentFlushPromise = null;
		this._resolveCurrentFlushPromise = null;
		this._rejectCurrentFlushPromise = null;
		if (error) {
			reject!(error);
			return;
		}
		resolve!();
	}

	private async _runFlushLoop(): Promise<void> {
		if (this._isFlushInProgress) {
			return this._currentFlushPromise!;
		}
		this._isFlushInProgress = true;
		this._scheduledFlushHandle = null;
		const flushPromise = this._ensureFlushPromise();
		try {
			do {
				this._dirty = false;
				await this._saveJsonToFile(this._jsonData, PATH_TO_LAST_REFRESHED);
			} while (this._dirty);
			this._finishFlushPromise(null);
		} catch (error) {
			this._finishFlushPromise(error);
			throw error;
		} finally {
			this._isFlushInProgress = false;
		}
		return flushPromise;
	}

	private _scheduleBufferedFlush(): Promise<void> {
		const flushPromise = this._ensureFlushPromise();
		if (this._scheduledFlushHandle || this._isFlushInProgress) {
			return flushPromise;
		}
		this._scheduledFlushHandle = this._scheduleFlush(() => {
			this._runFlushLoop().catch(() => {
				// The promise returned from markRefreshed/save carries the rejection.
			});
		}, this._flushDelayMs);
		return flushPromise;
	}

	/**
	 * @return [Promise<void>] lets you know when it has finished saving.
	 */
	save(): Promise<void> {
		this._dirty = true;
		this._ensureFlushPromise();
		if (this._scheduledFlushHandle) {
			this._clearScheduledFlush(this._scheduledFlushHandle);
			this._scheduledFlushHandle = null;
		}
		this._runFlushLoop().catch(() => {
			// The promise returned from save carries the rejection.
		});
		return this._currentFlushPromise!;
	}

	/**
	 * @param threadId [String]
	 * @return [Promise<void>] lets you know when it has finished saving.
	 */
	markRefreshed(threadId: string): Promise<void> {
		this._jsonData[threadId] = Date.now();
		this._dirty = true;
		return this._scheduleBufferedFlush();
	}

	/**
	 * @param threadId [String]
	 * @param lastMessageAdded [Number] number of milliseconds since the epoch
	 * marking the point in time that the most recent message in the thread was
	 * added to that thread.
	 * @param now [Number] number of milliseconds since the epoch, i.e. Date.now()
	 * @return [Boolean] true if the thread should be updated due to not having
	 * been updated in a while.
	 */
	needsRefreshing(threadId: string, lastMessageAdded: number, now: number): boolean {
		const threadLastRefreshed = this._jsonData[threadId];
		if (threadLastRefreshed === undefined) {
			return true;
		}
		const noMessagesForAtLeast = threadLastRefreshed - lastMessageAdded;
		const rawHaventCheckedFor = now - threadLastRefreshed;
		let normalizedHaventCheckedFor: number;
		if (rawHaventCheckedFor < 0) {
			logger.warn(`threadId ${threadId}: haventCheckedFor ${rawHaventCheckedFor} = now ${now} - threadLastRefreshed ${threadLastRefreshed} (now now ${Date.now()})`);
			normalizedHaventCheckedFor = 0;
		} else {
			normalizedHaventCheckedFor = rawHaventCheckedFor;
		}
		return normalizedHaventCheckedFor > noMessagesForAtLeast;
	}
}

/**
 * @return [Promise<LastRefreshedData>]
 */
export async function load(): Promise<LastRefreshedData> {
	const fileContents = await fileio.readJsonFromOptionalFile(PATH_TO_LAST_REFRESHED) as LastRefreshedJsonData;
	return new LastRefreshedData(fileContents);
}

export default {
	load,
	LastRefreshedData,
};

/**
 * Time 10: Message was added to thread
 * Time 20: Thread was refreshed
 * Time 21: now
 *
 * Don't refresh
 */
(function test1() {
	const messageLastAdded = 10;
	const threadWasRefreshed = 20;
	const now = 21;

	const underTest = new LastRefreshedData({
		'123': threadWasRefreshed
	});
	assert.equal(underTest.needsRefreshing('123', messageLastAdded, now), false);
})();

/**
 * Time 10: Message was added to thread
 * Time 20: Thread was refreshed
 * Time 200: now
 *
 * Refresh
 */
(function test2() {
	const messageLastAdded = 10;
	const threadWasRefreshed = 20;
	const now = 200;

	const underTest = new LastRefreshedData({
		'123': threadWasRefreshed
	});
	assert.equal(underTest.needsRefreshing('123', messageLastAdded, now), true);
})();
