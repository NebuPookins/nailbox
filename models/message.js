(() => {
	'use strict';

	const assert = require('assert');
	const logger = require('nebulog').make({filename: __filename, level: 'debug'});
	const mimelib = require('mimelib');
	const util = require('util');

	/**
	 * Given an input like:
	 *
	 *     Alfred Alpha <aa@gmail.com>, "Beta, Betty" <bb@gmail.com>
	 *
	 * returns an array that looks like
	 * [
	 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
	 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
	 * ]
	 */ 
	function parseEmailToString(str) {
		return mimelib.parseAddresses(str).map(entry => {
			var name = entry.name ? entry.name : entry.address;
			return {name: name, email: entry.address};
		});
	}
	(function test_parseEmailToString() {
		assert.deepEqual(parseEmailToString('"Alfred Alpha" <aa@gmail.com>'), [{name:'Alfred Alpha', email:'aa@gmail.com'}]);
		assert.deepEqual(parseEmailToString('Alfred Alpha <aa@gmail.com>'), [{name: "Alfred Alpha", email: 'aa@gmail.com'}]);
		assert.deepEqual(parseEmailToString(
			'"Alfred Alpha" <aa@gmail.com>, "Beta, Betty" <bb@gmail.com>'),
			[
				{name: 'Alfred Alpha', email: 'aa@gmail.com'},
				{name: 'Beta, Betty', email: 'bb@gmail.com'}
			]);
		assert.deepEqual(parseEmailToString(
			'Alfred Alpha <aa@gmail.com>, "Beta, Betty" <bb@gmail.com>'),
			[
				{name: "Alfred Alpha", email: 'aa@gmail.com'},
				{name: 'Beta, Betty', email: 'bb@gmail.com'}
			]);
		// If no name is provided, use the e-mail as the name
		assert.deepEqual(
			parseEmailToString('aa@gmail.com'),
			[{name: 'aa@gmail.com', email: 'aa@gmail.com'}]);
	})();

	function Message(data) {
		this._data = data;
		if (data.payload === undefined) {
			logger.warn('Malformed data; did not contain payload.');
		}
	}

	/**
	 * @param fnHeaderFilter Identifies the headers containing the e-mail addresses
	 * you're interested in. E.g. (header => header.name === 'To')
	 * @return an array that looks like:
	 * [
	 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
	 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
	 * ]
	 */
	Message.prototype.emailAddresses = function(fnHeaderFilter) {
		return this._data.payload.headers
			.filter(fnHeaderFilter)
			.map(header => parseEmailToString(header.value))
			.reduce((a, b) => a.concat(b), []); //Flatten the array of arrays.
	}

	/**
	 * Returns an object in the format { name: 'Alfred Alpha', email: 'aa@gmail.com'}
	 * representing the sender of this message. Returns null if there was no sender
	 */
	Message.prototype.sender = function() {
		const senders = this.emailAddresses(header => header.name === 'From');
		if (senders.length !== 1) {
			logger.warn(`Expected to have exactly 1 sender, but found ${senders.length} senders. Data was ${util.inspect(this._data)}`);
		}
		return senders.length === 0 ? null : senders[0];
	}

	exports.parseEmailToString = parseEmailToString; //TODO: Deprecated
	exports.Message = Message;
})();