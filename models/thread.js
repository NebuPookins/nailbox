(() => {
	'use strict';

	const q = require('q');
	const _ = require('lodash');
	const Message = require('./message').Message;

	function Thread(data) {
		this._data = data;
		this._messages = data.messages.map(m => new Message(m));
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
	Thread.prototype.people = function(fnFilter) {
		const people = this._messages.map(m => m.emailAddresses(fnFilter))
			.reduce((a, b) => a.concat(b)); //Flatten the array of arrays.
		return _.uniqBy(people, people => people.email);
	}

	/**
	 * @return [Number] milliseconds since the epoch, representing the last time
	 * a message got added to this thread.
	 */
	Thread.prototype.lastUpdated = function() {
		return _.max(this._messages.map(m => m.timestamp()));
	}

	exports.Thread = Thread; //TODO: This is temporary; prefer to use the get factory method.

	/**
	 * Factory method. Returns a promise to a Thread object.
	 */
	exports.get = (id) => {
		return q.Promise((resolve, reject) => {
			nodeFs.readFile('data/threads/' + id, (err, strFileContents) => {
				if (err) {
					return reject(err);
				} else {
					var jsonFileContents;
					try {
						jsonFileContents = JSON.parse(strFileContents);
					} catch (e) {
						if (e instanceof SyntaxError) {
							logger.warn(`Failed to parse JSON from ${id}`);
						}
						return reject(e);
					}
					return resolve(new Thread(jsonFileContents));
				}
			});
		});
	}
	//TODO
})();