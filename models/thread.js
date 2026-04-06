// @ts-nocheck
import { readFile } from 'node:fs/promises';
import _ from 'lodash';
import nebulog from 'nebulog';

import { Message } from './message.js';

const logger = nebulog.make({filename: 'models/thread.js', level: 'info'});

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
	return _.uniqBy(people, person => person.email);
};

/**
 * @return an array that looks like:
 * [
 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
 * ]
 */
Thread.prototype.senders = function() {
	const people = this._messages.map(m => m.sender())
		.filter(person => person != null);
	return _.uniqBy(people, person => person.email);
};

/**
 * @return an array that looks like:
 * [
 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
 * ]
 */
Thread.prototype.recipients = function() {
	const people = this._messages.map(m => m.recipients())
		.reduce((a, b) => a.concat(b)); //Flatten the array of arrays.
	return _.uniqBy(people, person => person.email);
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
		return '(no subject)';
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
	return this._messages.find(m => m.id() === messageId);
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
export async function get(id) {
	logger.debug(`Loading thread ${id}`);
	const threadFilename = `data/threads/${id}`;
	const fileContents = await readFile(threadFilename, 'utf8');
	const jsonFileContents = JSON.parse(fileContents);
	logger.debug(`Loaded thread ${id}`);
	return new Thread(jsonFileContents);
}

export default {
	get,
	Thread,
};
