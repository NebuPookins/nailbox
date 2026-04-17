import _ from 'lodash';
import assert from 'assert';
import htmlEntities from 'html-entities';
import nebulog from 'nebulog';
import mimelib from 'mimelib';
import util from 'util';

const Entities = htmlEntities.AllHtmlEntities;
const entities = new Entities();
const logger = nebulog.make({filename: 'models/message.ts', level: 'debug'});

export interface EmailAddress {
	name: string;
	email: string | undefined;
}

export interface GmailHeader {
	name: string;
	value: string;
}

export interface GmailMessageBody {
	attachmentId?: string;
	size: number | string;
	data?: string;
}

export interface GmailMessagePart {
	mimeType: string;
	filename?: string;
	body: GmailMessageBody;
	parts?: GmailMessagePart[];
}

export interface GmailPayload extends GmailMessagePart {
	headers: GmailHeader[];
}

export interface GmailMessageData {
	id: string;
	threadId: string;
	labelIds: string[];
	snippet: string;
	internalDate: string;
	payload: GmailPayload;
	fullBodyWordCount?: number;
	calculatedTimeToReadSeconds?: number;
}

export interface Attachment {
	filename: string | undefined;
	size: number;
	attachmentId: string;
}

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
function parseEmailToString(str: string): EmailAddress[] {
	return mimelib.parseAddresses(str).map((entry: {name: string; address: string}) => {
		const name = entry.name ? entry.name : (entry.address || '(unknown)');
		return {name: name, email: entry.address || undefined};
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
	// If no e-mail address is present (e.g. "undisclosed-recipients:;"), email should be undefined
	assert.deepEqual(
		parseEmailToString('undisclosed-recipients:;'),
		[{name: 'undisclosed-recipients', email: undefined}]);
})();

function formatPartAsHtml(messagePart: GmailMessagePart, threadId: string): string {
	logger.info(`Formatting part with mime type ${messagePart.mimeType} as HTML...`)
	switch (messagePart.mimeType) {
		case 'text/plain':
			return '<pre>' + entities.encode(mimelib.decodeBase64(messagePart.body.data ?? '')) + '</pre>';
		case 'text/html':
			return mimelib.decodeBase64(messagePart.body.data ?? '');
		default:
			logger.error(util.format("Don't know how to handle mimeType %s in thread %s.", messagePart.mimeType, threadId));
			return '';
	}
}

/**
 * @param messagePart If you have a message, then `message.payload` is probably
 * the messagePart that you want to pass in. More generally, a messagePart is
 * a hash that contains the fields `mimeType`, `body` and `parts`.
 * @param threadId [string] used for reporting error messages.
 * @return [object] the best found part (which may possibly be the part that
 * was passed in, if it contains no subparts).
 */
function selectedBestPart(messagePart: GmailMessagePart, threadId: string): GmailMessagePart {
	if (_.isArray(messagePart.parts) && messagePart.parts.length > 0) {
		/*
		 * Without needing to understand what the mimetype is (I've seen fucked up
		 * stuff like "text/related"), if we have multiple parts, recursively pick
		 * the best part from each of them.
		 */
		const bestParts = messagePart.parts.map(part => selectedBestPart(part, threadId));
		if (bestParts.length === 1) {
			return bestParts[0];
		}
		const bestHtmlParts = bestParts.filter(part => part.mimeType === 'text/html');
		if (bestHtmlParts.length > 0) {
			return _.maxBy(bestHtmlParts, part => parseInt(String(part.body.size))) ?? bestHtmlParts[0];
		}
		const bestPlainTextParts = bestParts.filter(part => part.mimeType === 'text/plain');
		if (bestPlainTextParts.length > 0) {
			return _.maxBy(bestPlainTextParts, part => parseInt(String(part.body.size))) ?? bestPlainTextParts[0];
		}
		logger.warn(`In thread ${threadId}, couldn't figure out the best part of ${messagePart.mimeType}. Arbitrarily returning the first part. Parts were ${util.inspect(bestParts)}`);
		return bestParts[0];
	} else {
		/*
		 * If there are no subparts, then just return this part as the best part.
		 */
		return messagePart;
	}
}
(function test_selectedBestPart() {
	console.log("Running tests on selectedBestPart...");
	const goodDecoded = "good";
	const goodEncoded = mimelib.encodeBase64(goodDecoded);
	(() => {
		// If the part is text/html, just return it.
		const bestPart: GmailMessagePart = {
			mimeType: 'text/html',
			body: {
				size: 1,
				data: "good"
			}
		};
		const selectedPart = selectedBestPart(bestPart, 'thread-id');
		assert.equal(selectedPart, bestPart);
	})();
	(() => {
		//Don't take the attachment, even if it's the biggest item in there.
		const secondBestPart: GmailMessagePart = {
			mimeType: 'text/plain',
			body: {
				size: 10,
				data: "bad"
			}
		};
		const bestPart: GmailMessagePart = {
			mimeType: 'text/html',
			body: {
				size: 100,
				data: "good"
			}
		};
		const attachment: GmailMessagePart = {
			mimeType: 'image/jpeg',
			body: {
				size: 1000,
				data: "bad"
			}
		};
		const selectedPart = selectedBestPart({
			mimeType: 'multipart/mixed',
			body: {size: 0},
			parts: [
				{
					mimeType: 'multipart/alternative',
					body: {size: 0},
					parts: [secondBestPart, bestPart]
				},
				attachment
			]
		}, 'thread-id');
		assert.equal(selectedPart, bestPart);
	})();
	(() => {
		// If there are multiple alternatives, picks the larger message, all other factors equal.
		const bestPart: GmailMessagePart = {
			"mimeType": "text/html",
			body: {
				size: 10,
				data: "good"
			}
		};
		const secondBestPart: GmailMessagePart = {
			"mimeType": "text/html",
			body: {
				size: 1,
				data: "bad"
			}
		};
		const selectedPart = selectedBestPart({
			mimeType: 'multipart/alternative',
			body: {size: 0},
			parts: [bestPart, secondBestPart]
		}, 'thread-id');
		assert.equal(selectedPart, bestPart);
	})();
	(() => {
		//Empirical from thread 1530198d39cabdf5, message 1530198d39cabdf5
		const bestPart: GmailMessagePart = {
			"mimeType": "text/html",
			"filename": "",
			"body": {
				"size": "1923",
				data: goodEncoded
			}
		};
		const layer1: GmailMessagePart = {
			mimeType: "multipart/related",
			filename: "",
			body: {
				size: "0"
			},
			parts: [bestPart]
		};
		const layer2: GmailMessagePart = {
			mimeType: 'multipart/mixed',
			body: {size: 0},
			parts: [layer1]
		};
		const selectedPart = selectedBestPart(layer2, 'thread-id');
		assert.equal(selectedPart, bestPart);
	})();
	(() => {
		const secondBestPart: GmailMessagePart = {
			mimeType: "text/plain",
			filename: "",
			body: {
				size: "3540",
				data: "bad"
			}
		};
		const bestPart: GmailMessagePart = {
			mimeType: "text/html",
			filename: "",
			body: {
				size: '15595',
				data: "good"
			}
		};
		const layer1: GmailMessagePart = {
			"mimeType": "text/related", //WTF? text/related?
			"filename": "",
			"body": {
				"size": "0"
			},
			parts: [bestPart]
		};
		const layer2: GmailMessagePart = {
			mimeType: "multipart/alternative",
			filename: "",
			body: {
				size: "0"
			},
			parts: [secondBestPart, layer1]
		};
		const selectedPart = selectedBestPart(layer2, 'thread-id');
		assert.deepEqual(selectedPart, bestPart);
	})();
})();

function getAttachments(messagePart: GmailMessagePart): Attachment[] {
	let retVal: Attachment[] = [];
	if (messagePart.body.attachmentId) {
		retVal.push({
			filename: messagePart.filename,
			size: parseInt(String(messagePart.body.size)),
			attachmentId: messagePart.body.attachmentId
		});
	}
	if (messagePart.parts) {
		messagePart.parts.forEach((part) => {
			retVal = retVal.concat(getAttachments(part));
		});
	}
	return retVal;
}

export class Message {
	private _data: GmailMessageData;

	constructor(data: GmailMessageData) {
		this._data = data;
		assert(this._data.id, util.inspect(data));
		assert(this._data.payload, util.inspect(data));
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
	emailAddresses(fnHeaderFilter: (header: GmailHeader) => boolean): EmailAddress[] {
		return this._data.payload.headers
			.filter(fnHeaderFilter)
			.map(header => parseEmailToString(header.value))
			.reduce((a, b) => a.concat(b), []); //Flatten the array of arrays.
	}

	/**
	 * Returns an object in the format { name: 'Alfred Alpha', email: 'aa@gmail.com'}
	 * representing the sender of this message. Returns null if there was no sender
	 */
	sender(): EmailAddress | null {
		const senders = this.emailAddresses(header => ['From', 'from'].some(expectedHeaderName => header.name === expectedHeaderName));
		if (senders.length !== 1) {
			logger.warn(`Expected to have exactly 1 sender, but found ${senders.length} senders. Data was ${util.inspect(this._data)} and senders were ${senders}. Headers where ${util.inspect(this._data.payload.headers)}`);
		}
		return senders.length === 0 ? null : senders[0];
	}

	/**
	 * Returns an object in the format { name: 'Alfred Alpha', email: 'aa@gmail.com'}
	 * representing person/address to reply to, according to this message. If there
	 * was a "Reply-To" header, that address is used. Else, if there's a sender,
	 * that address is used. Otherwise, null is returned.
	 */
	replyTo(): EmailAddress | null {
		const replyToAddr = this.emailAddresses(header => header.name === 'Reply-To');
		if (replyToAddr.length === 0) {
			return this.sender();
		} else if (replyToAddr.length === 1) {
			return replyToAddr[0];
		} else {
			logger.warn(`Expected to have exactly 1 Reply-To, but found ${replyToAddr.length} addresses. Data was ${util.inspect(this._data)} and addresses were ${replyToAddr}.`);
			return replyToAddr[0];
		}
	}

	/**
	 * @return an array that looks like:
	 * [
	 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
	 *   { name: 'Beta, Betty', email: 'bb@gmail.com'}
	 * ]
	 * representing the recipients of this message.
	 */
	recipients(): EmailAddress[] {
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
	header(headerName: string): GmailHeader | null {
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
	timestamp(): number {
		return parseInt(this._data.internalDate);
	}

	/**
	 * @return [String] a snippet of the message (e.g. the first few words.)
	 */
	snippet(): string {
		return this._data.snippet;
	}

	/**
	 * @return [String] returns the id gmail used to identify this message.
	 */
	id(): string {
		return this._data.id;
	}

	/**
	 * @return [Array<String>] the label ids associated with this message.
	 */
	labelIds(): string[] {
		return this._data.labelIds;
	}

	/**
	 * @return [String] uses heuristics to choose the "best" body out of all the
	 * mime parts available. The returned string will always be HTML formatted. So
	 * for example, if the best body is a text/plain, the returned string will be
	 * the that body wrapped in <pre></pre> tags.
	 */
	bestBody(): string {
		assert(this._data.payload, util.inspect(this._data));
		const bestPart = selectedBestPart(this._data.payload, this._data.threadId);
		return formatPartAsHtml(bestPart, this._data.threadId);
	}

	/**
	 * @return [Array<Hash>] example:
	 *  [{filename: 'IMG_2266.PNG', size: 260734, attachmentId: 'FOOBAR'}]
	 */
	getAttachments(): Attachment[] {
		return getAttachments(this._data.payload);
	}

	getBestReadTimeSeconds(): number {
		if (this._data.fullBodyWordCount) {
			return Math.round((this._data.fullBodyWordCount * 60) / 200);
		} else {
			return this._data.calculatedTimeToReadSeconds ?? 0;
		}
	}

	getInternalDate(): string {
		return this._data.internalDate;
	}
}

export default {
	Message,
};
