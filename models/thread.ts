import { readFile } from 'node:fs/promises';
import _ from 'lodash';
import nebulog from 'nebulog';

import { Message, GmailMessageData, EmailAddress, GmailHeader } from './message.js';

const logger = nebulog.make({filename: 'models/thread.ts', level: 'info'});

interface GmailThreadData {
	id: string;
	messages: GmailMessageData[];
}

export class Thread {
	private _data: GmailThreadData;
	private _messages: Message[];

	constructor(data: GmailThreadData) {
		this._data = data;
		this._messages = data.messages.map(m => new Message(m));
	}

	/**
	 * @param fnFilter Identifies the headers containing the e-mail addresses
	 * you're interested in. E.g. (header => header.name === 'To')
	 * @return an array that looks like:
	 * [
	 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
	 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
	 * ]
	 */
	people(fnFilter: (header: GmailHeader) => boolean): EmailAddress[] {
		const people = this._messages
			.map(m => m.emailAddresses(fnFilter))
			.reduce((a, b) => a.concat(b));
		return _.uniqBy(people, person => person.email);
	}

	/**
	 * @return an array that looks like:
	 * [
	 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
	 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
	 * ]
	 */
	senders(): EmailAddress[] {
		const people = this._messages
			.map(m => m.sender())
			.filter((person): person is EmailAddress => person !== null);
		return _.uniqBy(people, person => person.email);
	}

	/**
	 * @return an array that looks like:
	 * [
	 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
	 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
	 * ]
	 */
	recipients(): EmailAddress[] {
		const people = this._messages
			.map(m => m.recipients())
			.reduce((a, b) => a.concat(b));
		return _.uniqBy(people, person => person.email);
	}

	/**
	 * @return [Number] milliseconds since the epoch, representing the last time
	 * a message got added to this thread.
	 */
	lastUpdated(): number {
		return _.max(this._messages.map(m => m.timestamp())) ?? 0;
	}

	/**
	 * @param fnMessagePredicate [Function] a predicate which receives instances of Message.
	 * @return the message object, or null if no message satisfies the predicate.
	 * @deprecated use Thread.subject() or Thread.snippet() instead, assuming that's the
	 * data you're trying to get.
	 */
	mostRecentMessageSatisfying(fnMessagePredicate: (m: Message) => boolean): Message | null {
		const satisfyingMessages = this._messages.filter(fnMessagePredicate);
		if (satisfyingMessages.length === 0) {
			return null;
		}
		return _.maxBy(satisfyingMessages, message => message.timestamp()) ?? null;
	}

	/**
	 * @return [String] returns the subject to use to represent the whole thread.
	 */
	subject(): string {
		const newestMessageWithSubject = this.mostRecentMessageSatisfying(m =>
			m.header('Subject') !== null && (typeof m.header('Subject')) === 'object');
		if (newestMessageWithSubject === null) {
			return '(no subject)';
		}
		return newestMessageWithSubject.header('Subject')!.value;
	}

	/**
	 * @return [String] returns a snippet of the thread (the first few words of the most recent e-mail.)
	 */
	snippet(): string {
		const newestMessageWithSnippet = this.mostRecentMessageSatisfying(m => (typeof m.snippet()) === 'string');
		if (newestMessageWithSnippet === null) {
			logger.warn(`Thread ${this._data.id} has no messages with snippet. Can that actually happen?`);
			return '';
		}
		return newestMessageWithSnippet.snippet();
	}

	/**
	 * @return [String] the id gmail uses to identify this thread.
	 */
	id(): string {
		return this._data.id;
	}

	/**
	 * @return [Array<String>] returns the ids of all the messages in this thread.
	 */
	messageIds(): string[] {
		return this._messages.map(m => m.id());
	}

	/**
	 * @return [Array<String>]
	 */
	labelIds(): string[] {
		const labelsWithDuplicates = this._messages
			.map(m => m.labelIds())
			.reduce((a, b) => a.concat(b));
		return _.uniq(labelsWithDuplicates);
	}

	/**
	 * @return [Message] the message in this thread with the specified id, or null
	 * if there is no such message.
	 */
	message(messageId: string): Message | undefined {
		return this._messages.find(m => m.id() === messageId);
	}

	/**
	 * @return [Array<Message>] all messages in this thread.
	 */
	messages(): Message[] {
		return this._messages;
	}
}

/**
 * Factory method. Returns a promise to a Thread object.
 */
export async function get(id: string): Promise<Thread> {
	logger.debug(`Loading thread ${id}`);
	const threadFilename = `data/threads/${id}`;
	const fileContents = await readFile(threadFilename, 'utf8');
	const jsonFileContents: GmailThreadData = JSON.parse(fileContents);
	logger.debug(`Loaded thread ${id}`);
	return new Thread(jsonFileContents);
}

export default {
	get,
	Thread,
};
