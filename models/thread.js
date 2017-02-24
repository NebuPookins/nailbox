(() => {
	'use strict';

	const _ = require('lodash');
	const logger = require('nebulog').make({filename: __filename, level: 'info'});
	const Message = require('./message').Message;
	const nodeFs = require('node-fs');
	const q = require('q');
	const util = require('util');

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
	};

	/**
	 * @return [Number] milliseconds since the epoch, representing the last time
	 * a message got added to this thread.
	 */
	Thread.prototype.lastUpdated = function() {
		return _.max(this._messages.map(m => m.timestamp()));
	};

	/**
	 * @param fnMessagePredicate [Function] a predicate which receives instances of Message.
	 * @return the message object, or null if no message satisfies the predicate.
	 * @deprecated use Thread.subject() or Thread.snippet() instead, assuming that's the
	 * data you're trying to get.
	 */
	Thread.prototype.mostRecentMessageSatisfying = function(fnMessagePredicate) {
		const satisfyingMessages = this._messages.filter(fnMessagePredicate);
		if (satisfyingMessages.length === 0) {
			return null;
		}
		return _.maxBy(satisfyingMessages, message => message.timestamp());
	};

	/**
	 * @return [String] returns the subject to use to represent the whole thread.
	 */
	Thread.prototype.subject = function() {
		const newestMessageWithSubject = this.mostRecentMessageSatisfying(m =>
			m.header('Subject') !== null && (typeof m.header('Subject')) === 'object');
		if (newestMessageWithSubject === null) {
			logger.warn(`Thread ${this._data.id} has no messages with subject. Can that actually happen?`);
			return '';
		}
		return newestMessageWithSubject.header('Subject').value;
	};

	/**
	 * @return [String] returns a snippet of the thread (the first few words of the most recent e-mail.)
	 */
	Thread.prototype.snippet = function() {
		const newestMessageWithSnippet = this.mostRecentMessageSatisfying(m => (typeof m.snippet()) === 'string');
		if (newestMessageWithSnippet === null) {
			logger.warn(`Thread ${this._data.id} has no messages with snippet. Can that actually happen?`);
			return '';
		}
		return newestMessageWithSnippet.snippet();
	};

	/**
	 * @return [String] the id gmail uses to identify this thread.
	 */
	Thread.prototype.id = function() {
		return this._data.id;
	};

	/**
	 * @return [Array<String>] returns the ids of all the messages in this thread.
	 */
	Thread.prototype.messageIds = function() {
		return this._messages.map(m => m.id());
	};

	/**
	 * @return [Array<String>]
	 */
	Thread.prototype.labelIds = function() {
		const labelsWithDuplicates = this._messages
			.map(m => m.labelIds())
			.reduce((a, b) => a.concat(b)); //Flatten the array of arrays.
		return _.uniq(labelsWithDuplicates);
	};

	/**
	 * @return [Message] the message in this thread with the specified id, or null
	 * if there is no such message.
	 */
	Thread.prototype.message = function(messageId) {
		return this._messages.find(m => m.id() == messageId);
	};

	/**
	 * @return [Array<Message>] all messages in this thread.
	 */
	Thread.prototype.messages = function() {
		return this._messages;
	};

	/**
	 * Factory method. Returns a promise to a Thread object.
	 */
	exports.get = (id) => {
		logger.debug(`Loading thread ${id}`);
		return q.Promise((resolve, reject) => {
			logger.debug(`nodeFs.readFile('data/threads/${id}')`);
			const threadFilename = 'data/threads/' + id;
			nodeFs.readFile(threadFilename, (err, strFileContents) => {
				logger.debug(`nodeFs.readFile returned for thread ${id}`);
				if (err) {
					logger.error('Failed to read from ' + threadFilename);
					logger.error(util.inspect(err));
					return reject(err);
				} else {
					var jsonFileContents;
					try {
						jsonFileContents = JSON.parse(strFileContents);
					} catch (e) {
						if (e instanceof SyntaxError) {
							logger.warn(`Failed to parse JSON from ${id}`);
						}
						logger.error(util.inspect(err));
						return reject(e);
					}
					logger.debug(`Loaded thread ${id}`);
					return resolve(new Thread(jsonFileContents));
				}
			});
		});
	};
})();