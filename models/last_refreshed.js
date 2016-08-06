(() => {
	'use strict';
	const PATH_TO_LAST_REFRESHED = 'data/LastRefreshed.json';

	const assert = require('assert');
	const fileio = require('../helpers/fileio');
	const nodeFs = require('node-fs');
	const q = require('q');

	/**
	 * @param jsonData [Hash]
	 */
	function LastRefreshedData(jsonData) {
		this._jsonData = jsonData;
	}

	/**
	 * @return [Promise<Void>] lets you know when it has finished saving.
	 */
	LastRefreshedData.prototype.save = function() {
		return fileio.saveJsonToFile(this._jsonData, PATH_TO_LAST_REFRESHED);
	};

	/**
	 * @param threadId [Number]
	 * @return [Promise<Void>] lets you know when it has finished saving.
	 */
	LastRefreshedData.prototype.markRefreshed = function(threadId) {
		this._jsonData[threadId] = Date.now();
		return this.save();
	};

	/**
	 * @param threadId [Number]
	 * @param lastMessageAdded [Number] number of milliseconds since the epoch
	 * marking the point in time that the most recent message in the thread was
	 * added to that thread.
	 * @param now [Number] number of seconds since the epoch, i.e. Date.now()
	 * @return [Boolean] true if the thread should be updated due to not having
	 * been updated in a while.
	 */
	LastRefreshedData.prototype.needsRefreshing = function(
			threadId, lastMessageAdded, now) {
		const threadLastRefreshed = this._jsonData[threadId];
		if (threadLastRefreshed === undefined) {
			return true;
		}
		const noMessagesForAtLeast = threadLastRefreshed - lastMessageAdded;
		//assert(noMessagesForAtLeast >= 0, `noMessagesForAtLeast ${noMessagesForAtLeast} = threadLastRefreshed ${threadLastRefreshed} - lastMessageAdded ${lastMessageAdded}`);
		const haventCheckedFor = now - threadLastRefreshed;
		assert(haventCheckedFor >= 0, `haventCheckedFor ${haventCheckedFor} = now ${now} - threadLastRefreshed ${threadLastRefreshed}`);
		return haventCheckedFor > noMessagesForAtLeast;
	};

	/**
	 * @return [Promise<LastRefreshedData>]
	 */
	exports.load = () => {
		return fileio.readJsonFromOptionalFile(PATH_TO_LAST_REFRESHED).then((objFileContents) => {
			return new LastRefreshedData(objFileContents);
		});
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
			123: threadWasRefreshed
		});
		assert.equal(underTest.needsRefreshing(123, messageLastAdded, now), false);
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
			123: threadWasRefreshed
		});
		assert.equal(underTest.needsRefreshing(123, messageLastAdded, now), true);
	})();
})();