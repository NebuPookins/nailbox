(() => {
	'use strict';

	const assert = require('assert');
	const logger = require('nebulog').make({filename: __filename, level: 'debug'});

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
		/*
		 * We're using a hack here where String.replace accepts a callback which is
		 * invoked for each match in a regexp. We're not interested in the String that
		 * results from the replacement, but we can have our callback function perform
		 * side effects so that we can extract each match.
		 */
		var retVal = [];
		str.replace(/("[^"]+"|[^,]+) <([^>]+)>/g, function(match, p1, p2) {
			retVal.push({ name: p1, email: p2});
		});
		return retVal;
	}
	(function test_parseEmailToString() {
		assert.deepEqual(parseEmailToString('"Alfred Alpha" <aa@gmail.com>'), [{name:'"Alfred Alpha"', email:'aa@gmail.com'}]);
		assert.deepEqual(parseEmailToString('Alfred Alpha <aa@gmail.com>'), [{name: "Alfred Alpha", email: 'aa@gmail.com'}]);
		assert.deepEqual(parseEmailToString(
			'"Alfred Alpha" <aa@gmail.com>, "Beta, Betty" <bb@gmail.com>'),
			[
				{name: '"Alfred Alpha"', email: 'aa@gmail.com'},
				{name: '"Beta, Betty"', email: 'bb@gmail.com'}
			]);
		assert.deepEqual(parseEmailToString(
			'Alfred Alpha <aa@gmail.com>, "Beta, Betty" <bb@gmail.com>'),
			[
				{name: "Alfred Alpha", email: 'aa@gmail.com'},
				{name: '"Beta, Betty"', email: 'bb@gmail.com'}
			]);
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

	exports.parseEmailToString = parseEmailToString; //TODO: Deprecated
	exports.Message = Message;
})();