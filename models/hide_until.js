(() => {
	'use strict';
	const PATH_TO_HIDE_UNTILS = 'data/hideUntils.json';

	const assert = require('assert');
	const fileio = require('../helpers/fileio');
	const logger = require('nebulog').make({filename: __filename, level: 'debug'});
	const nodeFs = require('node-fs');
	const q = require('q');
	const util = require('util');

	function HideUntil() {
	}

	/**
	 * @param threadLastUpdated [Number] number of milliseconds since the epoch.
	 * @param now [Number, Undefined] number of milliseconds since the epoch.
	 * @return [String]
	 *   'visible' if the message should be shown normally.
	 *   'when-i-have-time' if the message should be shown, but at a low priority.
	 *   'hidden' if the message should not be shown.
	 */
	HideUntil.prototype.getVisibility = function(threadLastUpdated, now) {
		throw "AbstractMethod needs implementation.";
	};

	/**
	 * @return [boolean]
	 */
	HideUntil.prototype.isWhenIHaveTime = function() {
		throw "AbstractMethod needs implementation.";
	};

	//////////////////////////////////////////////////////////////////////////////

	function HideUntilTimestamp(data) {
		HideUntil.call(this);
		assert('timestamp' === data.type, util.inspect(data));
		assert(['string','number'].indexOf(typeof data.value) > -1, util.inspect(data));
		this._data = data;
		if (data.hiddenOn) {
			assert((typeof data.hiddenOn) === 'number', util.inspect(data));
		} else {
			/*
			 * 1459135641259 (AKA 2016, March 27) is when this property was added. If
			 * the property did not exist, just assume it was hidden "around now".
			 */
			this._data = 1459135641259;
		}
	}
	HideUntilTimestamp.prototype = Object.create(HideUntil.prototype);

	/**
	 * @override
	 */
	HideUntilTimestamp.prototype.getVisibility = function(threadLastUpdated, now) {
		if (now === undefined) {
			now = Date.now();
		}
		if (threadLastUpdated > this._data.hiddenOn) {
			return 'visible';
		}
		if (now > Number.parseInt(this._data.value)) {
			return 'visible';
		} else {
			return 'hidden';
		}
	};

	/**
	 * @override
	 */
	HideUntilTimestamp.prototype.isWhenIHaveTime = function() {
		return false;
	};

	//////////////////////////////////////////////////////////////////////////////

	function HideUntilIHaveTime(data) {
		HideUntil.call(this);
		assert('when-i-have-time' === data.type, util.inspect(data));
		assert((typeof data.hiddenOn) === 'number', util.inspect(data));
		this._data = data;
	}
	HideUntilIHaveTime.prototype = Object.create(HideUntil.prototype);

	/**
	 * @override
	 */
	HideUntilIHaveTime.prototype.getVisibility = function(threadLastUpdated, now) {
		if (now === undefined) {
			now = Date.now();
		}
		if (threadLastUpdated > this._data.hiddenOn) {
			return 'visible';
		}
		return 'when-i-have-time';
	};

	/**
	 * @override
	 */
	HideUntilIHaveTime.prototype.isWhenIHaveTime = function() {
		return true;
	};

	//////////////////////////////////////////////////////////////////////////////

	function EmptyHideUntil() {
		HideUntil.call(this);
	}
	EmptyHideUntil.prototype = Object.create(HideUntil.prototype);

	/**
	 * @override
	 */
	EmptyHideUntil.prototype.getVisibility = function(threadLastUpdated, now) {
		return 'visible';
	};

	/**
	 * @override
	 */
	EmptyHideUntil.prototype.isWhenIHaveTime = function() {
		return false;
	};

	//////////////////////////////////////////////////////////////////////////////

	function HideUntilData(jsonData) {
		assert((typeof jsonData) === 'object', util.inspect(jsonData));
		this._jsonData = jsonData;
	}

	/**
	 * @param threadId [Number]
	 * @return [HideUntil]
	 */
	HideUntilData.prototype.get = function(threadId) {
		assert((typeof threadId) === 'string', `Expected threadId to be string but was ${typeof threadId}.`);
		const data = this._jsonData[threadId];
		/* data example:
		 *    {"type":"timestamp","value":"1455501600000", "hiddenOn":1459104449187}
		 *    OR
		 *    {"type":"when-i-have-time","hiddenOn":1459104449187}
		 */
		if (data) {
			switch (data.type) {
				case 'timestamp':
					return new HideUntilTimestamp(data);
				case 'when-i-have-time':
					return new HideUntilIHaveTime(data);
				default:
					throw `Don't know how to handle type ${data.type}`;
			}
		} else {
			return new EmptyHideUntil();
		}
	};

	/**
	 * @param threadId [Number]
	 * @param timestamp [Number] Milliseconds since the epoch. Example:
	 * @return [Promise<Void>] lets you know when it has finished saving.
	 */
	HideUntilData.prototype.hideUntilTimestamp = function(threadId, timestamp) {
		this._jsonData[threadId] = {
			type: 'timestamp',
			value: timestamp,
			hiddenOn: Date.now()
		};
		return this.save();
	};

	/**
	 * @param threadId [Number]
	 * @param timestamp [Number] Milliseconds since the epoch. Example:
	 * @return [Promise<Void>] lets you know when it has finished saving.
	 */
	HideUntilData.prototype.hideUntilIHaveTime = function(threadId) {
		this._jsonData[threadId] = {
			type: 'when-i-have-time',
			hiddenOn: Date.now()
		};
		return this.save();
	};

	/**
	 * @return [Promise<Void>] lets you know when it has finished saving.
	 */
	HideUntilData.prototype.save = function() {
		return fileio.saveJsonToFile(this._jsonData, PATH_TO_HIDE_UNTILS);
	};

	/**
	 * Returns a comparator (function) that sorts messages so that "newer" ones
	 * show up near the top, a message timestamp-hidden to 2015-jan-01 is treated as
	 * if it was lastUpdated on 2015-jan-01. Messages that are hidden "until I have
	 * time" are sorted last.
	 *
	 * The returned function takes 2 params and expects them to be objects with
	 * properties "threadId" and "lastUpdated".
	 */
	HideUntilData.prototype.comparator = function() {
		return (a, b) => {
			const hideAUntil = this.get(a.threadId);
			const hideBUntil = this.get(b.threadId);
			if (hideAUntil instanceof HideUntilIHaveTime) {
				if (hideBUntil instanceof HideUntilIHaveTime) {
					return hideBUntil._data.hiddenOn - hideAUntil._data.hiddenOn;
				} else if (hideBUntil instanceof HideUntilTimestamp) {
					return 1;
				} else if (hideBUntil instanceof EmptyHideUntil) {
					return 1;
				} else {
					logger.error(`Don't know how to sort with ${util.inspect(hideBUntil)}.`);
					return 0;
				}
			} else if (hideAUntil instanceof HideUntilTimestamp) {
				if (hideBUntil instanceof HideUntilIHaveTime) {
					return -1;
				} else if (hideBUntil instanceof HideUntilTimestamp) {
					return hideBUntil._data.value - hideAUntil._data.value;
				} else if (hideBUntil instanceof EmptyHideUntil) {
					return b.lastUpdated - hideAUntil._data.value;
				} else {
					logger.error(`Don't know how to sort with ${util.inspect(hideBUntil)}.`);
					return 0;
				}
			} else if (hideAUntil instanceof EmptyHideUntil) {
				if (hideBUntil instanceof HideUntilIHaveTime) {
					return -1;
				} else if (hideBUntil instanceof HideUntilTimestamp) {
					return hideBUntil._data.value - a.lastUpdated;
				} else if (hideBUntil instanceof EmptyHideUntil) {
					return b.lastUpdated - a.lastUpdated;
				} else {
					logger.error(`Don't know how to sort with ${util.inspect(hideBUntil)}.`);
					return 0;
				}
			} else {
				logger.error(`Don't know how to sort with ${util.inspect(hideAUntil)}.`);
				return 0;
			}
		};
	};

	/**
	 * @return [Promise<HideUntilData>]
	 */
	exports.load = () => {
		return q.Promise((resolve, reject) => {
			nodeFs.readFile(PATH_TO_HIDE_UNTILS, (err, strFileContents) => {
				if (err) {
					return reject(err);
				} else {
					return resolve(new HideUntilData(JSON.parse(strFileContents)));
				}
			});
		});
	};
})();