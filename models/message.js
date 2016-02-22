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
	 *   { name: 'Beta, Betty', email: 'bb@gmail.com'}
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
	 *   { name: 'Beta, Betty', email: 'bb@gmail.com'}
	 * ]
	 * @deprecated use sender() or recipients() instead.
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
			logger.warn(`Expected to have exactly 1 sender, but found ${senders.length} senders. Data was ${util.inspect(this._data)} and senders was ${senders}.`);
		}
		return senders.length === 0 ? null : senders[0];
	}

	/**
	 * @return an array that looks like:
	 * [
	 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
	 *   { name: 'Beta, Betty', email: 'bb@gmail.com'}
	 * ]
	 * representing the recipients of this message.
	 */
	Message.prototype.recipients = function() {
		return this.emailAddresses(header => header.name === 'To');
	}

	/**
	 * @return an object that looks like:
	 * {
	 *   "name": "Subject",
	 *   "value": "Hello world!"
	 * }
	 * representing the header in this message with the specified name. Returns
	 * null if there is no header with the specified name.
	 */
	Message.prototype.header = function(headerName) {
		const matchingHeader = this._data.payload.headers
			.filter(header => header.name === headerName);
		if (matchingHeader.length === 0) {
			return null;
		}
		if (matchingHeader.length !== 1) {
			logger.warn(`Expected either 0 or 1 headers with the name ${headerName}, but found ${matchingHeader.length} matching headers. Data was ${util.inspect(this._data)} and watching headers were ${matchingHeader}.`);
		}
		return matchingHeader[0];
	}

	/**
	 * @return [Number] milliseconds since epoch. It's not clear exactly what this
	 * contractually represents. It's probably close to "when the e-mail was
	 * received" by gmail.
	 */
	Message.prototype.timestamp = function() {
		return parseInt(this._data.internalDate);
	}

	exports.Message = Message;
})();