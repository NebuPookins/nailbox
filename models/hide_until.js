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
	 * @param now [Number] number of milliseconds since the epoch.
	 * @return [String]
	 *   'updated' if the thread was updated since the last time it was hidden
	 *             (or if the thread was never hidden)
	 *   'visible' if the message was previously hidden, but is time for it to
	 *             be visible again.
	 *   'when-i-have-time' if the message should be shown, but at a low priority.
	 *   'hidden' if the message should not be shown.
	 */
	HideUntil.prototype.getVisibility = function(threadLastUpdated, now) {
		throw "AbstractMethod needs implementation.";
	};

	/**
	 * @return [boolean] true if this is an instance of HideUntilIHaveTime, false otherwise.
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
			this._data.hiddenOn = 1459135641259;
		}
	}
	HideUntilTimestamp.prototype = Object.create(HideUntil.prototype);

	/**
	 * @override
	 */
	HideUntilTimestamp.prototype.getVisibility = function(threadLastUpdated, now) {
		if (threadLastUpdated > this._data.hiddenOn) {
			return 'updated';
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
		if (threadLastUpdated > this._data.hiddenOn) {
			return 'updated';
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
		return 'updated';
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
	 * @param thread [Thread]
	 * @return [HideUntil]
	 */
	HideUntilData.prototype.get = function(thread) {
		assert((typeof thread) === 'object', `Expected thread to be an object but was ${typeof thread}.`);
		assert((typeof thread.threadId) === 'string', `Expected thread.threadId to be a string but was ${typeof thread.threadId}.`);
		assert((typeof thread.lastUpdated) === 'number', `Expected thread.lastUpdated to be a number but was ${typeof thread.lastUpdated}.`);
		const data = this._jsonData[thread.threadId];
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

	const comparatorFactory = function(mockableHideUntilData) {
		const retVal = (a, b) => {
			const BFirst = 1;
			const AFirst = -1;
			const hideAUntil = mockableHideUntilData.get(a);
			const hideBUntil = mockableHideUntilData.get(b);

			if (hideBUntil instanceof HideUntilIHaveTime) {
				if (hideAUntil instanceof HideUntilIHaveTime) {
					return Math.random() > 0.5 ? AFirst : BFirst;
				} else {
					return -retVal(b, a);
				}
				assert.fail("Can't reach this line.");
			}
			if (hideAUntil instanceof HideUntilIHaveTime) {
				if (hideBUntil instanceof HideUntilTimestamp) {
					return BFirst;
				} else if (hideBUntil instanceof EmptyHideUntil) {
					return BFirst;
				} else {
					logger.error(`Don't know how to sort with ${util.inspect(hideBUntil)}.`);
					return 0;
				}
				assert.fail("Can't reach this line.");
			}
			if (hideBUntil instanceof HideUntilTimestamp) {
				if (hideAUntil instanceof HideUntilTimestamp) {
					if (a.lastUpdated > hideAUntil._data.hiddenOn) {
						if (b.lastUpdated > hideBUntil._data.hiddenOn) {
							//Both were updated, so show the most recently updated one first.
							return a.lastUpdated > b.lastUpdated ? AFirst : BFirst;
						} else {
							//A was updated but B was not. Show A first.
							return AFirst;
						}
						assert.fail("Can't reach this line.");
					} else {
						if (b.lastUpdated > hideBUntil._data.hiddenOn) {
							//B was updated but A was not. Show B first.
							return BFirst;
						} else {
							/*
							 * Neither have been updated since they were hidden, so show the
							 * one that's been hidden the longest first.
							 */
							return hideAUntil._data.hiddenOn < hideBUntil._data.hiddenOn ?
								AFirst : BFirst;
						}
						assert.fail("Can't reach this line.");
					}
					assert.fail("Can't reach this line.");
				} else {
					return -retVal(b, a);
				}
				assert.fail("Can't reach this line.");
			}
			if (hideAUntil instanceof HideUntilTimestamp) {
				if (hideBUntil instanceof EmptyHideUntil) {
					if (a.lastUpdated > hideAUntil._data.hiddenOn) {
						/*
						 * A has been updated and B is a new thread, so show most recently
						 * updated first.
						 */
						return a.lastUpdated > b.lastUpdated ? AFirst : BFirst;
					} else {
						/*
						 * A hasn't been updated since it was hidden, while B is brand new
						 * thread, so show B first.
						 */
						return BFirst;
					}
					assert.fail("Can't reach this line.");
				} else {
					logger.error(`Don't know how to sort with ${util.inspect(hideBUntil)}.`);
					return 0;
				}
				assert.fail("Can't reach this line.");
			}
			if (hideAUntil instanceof EmptyHideUntil) {
				if (hideBUntil instanceof EmptyHideUntil) {
					return a.lastUpdated < b.lastUpdated ?
						BFirst : AFirst;
				} else {
					logger.error(`Don't know how to sort with ${util.inspect(hideBUntil)}.`);
					return 0;
				}
				assert.fail("Can't reach this line.");
			} else {
				logger.error(`Don't know how to sort with ${util.inspect(hideAUntil)}.`);
				return 0;
			}
			assert.fail("Can't reach this line.");
		};
		return retVal;
	}

	/**
	 * Returns a comparator (function) that sorts messages so that "newer" ones
	 * show up near the top.
	 *
	 * The comparator takes two instances of Thread.
	 *
	 * We basically have 3 sections:
	 *
	 * All messages which have an update since the last time they were hidden
	 * (or which will never hidden at all) show up first, sorted by the order of
	 * those updates.
	 *
	 * Then messages which were hidden, but their hidden-until expired are shown,
	 * ordered by the date on which the hiding was performed.
	 *
	 * Finally, any messages that were hidden "until I have time" are shown, in a
	 * shuffled order.
	 *
	 * The returned function takes 2 params and expects them to be objects with
	 * properties "threadId" and "lastUpdated".
	 */
	HideUntilData.prototype.comparator = function() {
		return comparatorFactory(this);
	};

	(function test_comparator_test_HideUntilIHaveTime_vs_test_HideUntilIHaveTime() {
		/*
		 * If two threads are both "HideUntilIHaveTime", then it doesn't matter
		 * what order they show up in.
		 */
	})();
	(function test_comparator_test_HideUntilIHaveTime_vs_HideUntilTimestamp() {
		/*
		 * If one thread is "HideUntilIHaveTime" and the other is
		 * "HideUntilTimestamp", then always show the "HideUntilTimestamp" first.
		 * We're assuming some other process is going to filter out the
		 * "HideUntilTimestamp" that should still be hidden.
		 */
		const a = {
			lastUpdated: 1
		};
		const b = {
			lastUpdated: 2
		};
		const mockHideUntilData = {
			get: function(thread) {
				if (thread == a) {
					return new HideUntilTimestamp({
						type: 'timestamp',
						value: 10,
						hiddenOn: 3
					});
				}
				if (thread == b) {
					return new HideUntilIHaveTime({
						type: 'when-i-have-time',
						hiddenOn: 4
					});
				}
			}
		};
		const underTest = comparatorFactory(mockHideUntilData);
		const results = underTest(a, b);
		assert.equal(results, -1)
	})();
	(function test_comparator_test_HideUntilIHaveTime_vs_EmptyHideUntil() {
		/*
		 * If one thread is "HideUntilIHaveTime" and the other is
		 * "EmptyHideUntil", then always show the "EmptyHideUntil" first.
		 */
		const a = {
			lastUpdated: 1
		};
		const b = {
			lastUpdated: 2
		};
		const mockHideUntilData = {
			get: function(thread) {
				if (thread == a) {
					return new EmptyHideUntil();
				}
				if (thread == b) {
					return new HideUntilIHaveTime({
						type: 'when-i-have-time',
						hiddenOn: 4
					});
				}
			}
		};
		const underTest = comparatorFactory(mockHideUntilData);
		const results = underTest(a, b);
		assert.equal(results, -1)
	})();
	(function test_comparator_HideUntilTimestamp_vs_HideUntilTimestamp_scenario1() {
		/*
		 * If you have 2 threads both with HideUntilTimestamp, and they look like:
		 * T=1 Thread A last updated.
		 * T=2 Thread B last updated.
		 * T=3 Thread A hiddenOn.
		 * T=4 Thread B hiddenOn.
		 * T=5 Thread A hideUntil
		 * T=6 Thread B hideUntil
		 *
		 * Then show thread A first. The key factor is that Thread A was "hidden"
		 * more long ago than Thread B, and so should appear nearer to the top to
		 * prompt the user.
		 */
		const a = {
			lastUpdated: 1
		};
		const b = {
			lastUpdated: 2
		};
		const mockHideUntilData = {
			get: function(thread) {
				if (thread == a) {
					return new HideUntilTimestamp({
						type:"timestamp",
						value: 5,
						hiddenOn: 3
					});
				}
				if (thread == b) {
					return new HideUntilTimestamp({
						type:"timestamp",
						value: 6,
						hiddenOn: 4
					});
				}
			}
		};
		const underTest = comparatorFactory(mockHideUntilData);
		const results = underTest(a, b);
		assert.equal(results, -1);
	})();
	(function test_comparator_HideUntilTimestamp_vs_HideUntilTimestamp_scenario2() {
		/*
		 * If you have 2 threads both with HideUntilTimestamp, and they look like:
		 * T=1 Thread A last updated.
		 * T=2 Thread A hiddenOn.
		 * T=3 Thread B hiddenOn.
		 * T=4 Thread B last updated.
		 * T=5 Thread A hideUntil
		 * T=6 Thread B hideUntil
		 *
		 * Then show thread B first. Although Thread A was hidden for longer than
		 * thread B, thread B got updated with a new message.
		 */
		const a = {
			lastUpdated: 1
		};
		const b = {
			lastUpdated: 4
		};
		const mockHideUntilData = {
			get: function(thread) {
				if (thread == a) {
					return new HideUntilTimestamp({
						type:"timestamp",
						value: 5,
						hiddenOn: 2
					});
				}
				if (thread == b) {
					return new HideUntilTimestamp({
						type:"timestamp",
						value: 6,
						hiddenOn: 3
					});
				}
			}
		};
		const underTest = comparatorFactory(mockHideUntilData);
		const results = underTest(a, b);
		assert.equal(results, 1);
	})();
	(function test_comparator_HideUntilTimestamp_vs_EmptyHideUntil_scenario1() {
		/*
		 * Let's say Thread A was "hiddenOn" T = 1, with "hideUntil" T = 4 but
		 * subsequently has a new message T = 3 in it.
		 * Relative to Thread B whose newest message is T = 2, Thread A should appear
		 * first: It got a new message, so we "ignore" the fact that it was hidden
		 * for the purposes of sorting, and place it as if it was just a new thread.
		 */
		const a = {
			lastUpdated: 3
		};
		const b = {
			lastUpdated: 2
		};
		const mockHideUntilData = {
			get: function(thread) {
				if (thread == a) {
					return new HideUntilTimestamp({
						type:"timestamp",
						value: 4,
						hiddenOn: 1
					});
				}
				if (thread == b) {
					return new EmptyHideUntil();
				}
			}
		};
		const underTest = comparatorFactory(mockHideUntilData);
		const results = underTest(a, b);
		assert.equal(results, -1);
	})();
	(function test_comparator_HideUntilTimestamp_vs_EmptyHideUntil_scenario2() {
		/*
		 * Let's say Thread A has lastUpdated = 1, was "hiddenOn" T = 2,
		 * with "hideUntil" T = 4.
		 * Relative to Thread B whose newest message is T = 3, Thread B should appear
		 * first.
		 */
		const a = {
			lastUpdated: 1
		};
		const b = {
			lastUpdated: 3
		};
		const mockHideUntilData = {
			get: function(thread) {
				if (thread == a) {
					return new HideUntilTimestamp({
						type:"timestamp",
						value: 4,
						hiddenOn: 2
					});
				}
				if (thread == b) {
					return new EmptyHideUntil();
				}
			}
		};
		const underTest = comparatorFactory(mockHideUntilData);
		const results = underTest(a, b);
		assert.equal(results, 1);
	})();
	(function test_comparator_EmptyHideUntil_vs_EmptyHideUntil() {
		/*
		 * If two threads both have empty HideUntils, then show the one with the
		 * most recent lastUpdated.
		 */
		const a = {
			lastUpdated: 1
		};
		const b = {
			lastUpdated: 3
		};
		const mockHideUntilData = {
			get: function(thread) {
				if (thread == a) {
					return new EmptyHideUntil();
				}
				if (thread == b) {
					return new EmptyHideUntil();
				}
			}
		};
		const underTest = comparatorFactory(mockHideUntilData);
		const results = underTest(a, b);
		assert.equal(results, 1);
	})();

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

	//////////////////////////////////////////////////////////////////////////////
	(function test() {
		const underTest = new HideUntilTimestamp({
			type:"timestamp",
			value: 1
		});
		const lastUpdated = 2;
		const now = 3;
		assert.equal(underTest.getVisibility(lastUpdated, now), 'visible');
	})();
})();