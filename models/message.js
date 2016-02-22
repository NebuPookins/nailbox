(() => {
	'use strict';

	const _ = require('lodash');
	const assert = require('assert');
	const Entities = require('html-entities').AllHtmlEntities;
	const entities = new Entities();
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

	/**
	 * @return [String] a snippet of the message (e.g. the first few words.)
	 */
	Message.prototype.snippet = function() {
		return this._data.snippet;
	}

	/**
	 * @return [String] returns the id gmail used to identify this message.
	 */
	Message.prototype.id = function() {
		return this._data.id;
	}

	/**
	 * @return [Array<String>] the label ids associated with this message.
	 */
	Message.prototype.labelIds = function() {
		return this._data.labelIds;
	}

	/**
	 * @param messagePart If you have a message, then `message.payload` is probably
	 * the messagePart that you want to pass in. More generally, a messagePart is
	 * a hash that contains the fields `mimeType`, `body` and `parts`.
	 * @param threadId [string] used for reporting error messages.
	 * @return [string] the body of the e-mail.
	 */
	function getBestBodyFromMessage(messagePart, threadId) {
		switch (messagePart.mimeType) {
			case 'text/plain':
				return '<pre>' + entities.encode(mimelib.decodeBase64(messagePart.body.data)) + '</pre>';
			case 'text/html':
				return mimelib.decodeBase64(messagePart.body.data);
			case 'multipart/alternative':
				var biggestPart;
				//If there's an HTML version (as opposed to text/plain), prefer that version.
				const htmlParts = messagePart.parts.filter(part => part.mimeType === 'text/html');
				if (htmlParts.length > 0) {
					if (htmlParts.length == 1) {
						logger.debug(util.format("Thread %s is multipart/alternative. Picking part with partId %s mime-type %s because it's the only text/html content.", threadId, htmlParts[0].partId, htmlParts[0].mimeType));
						return getBestBodyFromMessage(htmlParts[0]);
					} else {
						biggestPart = _.maxBy(htmlParts, part => parseInt(part.body.size));
						logger.debug(util.format("Thread %s is multipart/alternative. Picking part with partId %s mime-type %s because it's the biggest text/html content.", threadId, biggestPart.partId, biggestPart.mimeType));
						return getBestBodyFromMessage(biggestPart, threadId);
					}
				}
				//Otherwise just pick the biggest among all the available parts.
				biggestPart = _.maxBy(messagePart.parts, part => parseInt(part.body.size));
				logger.debug(util.format("Thread %s is multipart/alternative. Picking part with partId %s mime-type %s because it's the biggest.", threadId, biggestPart.partId, biggestPart.mimeType));
				return getBestBodyFromMessage(biggestPart, threadId);
			case 'multipart/mixed':
				//I think this means there's attachments.
				const nonAttachments = messagePart.parts.filter(function(part) {
					if (part.mimeType == 'multipart/alternative') {
						return true;
					}
					if (part.mimeType == 'text/plain') {
						return true;
					}
					if (part.mimeType == 'text/html') {
						return true;
					}
					//TODO: What other mimetypes do we want to keep?
					return false;
				});
				if (nonAttachments.length == 1) {
					return getBestBodyFromMessage(nonAttachments[0], threadId);
				}
				logger.error(util.format("Don't know how to decide between mimeTypes %s in thread %s.", nonAttachments.map(p => p.mimeType), threadId));
				return null;
			case 'multipart/related':
				/*
				 * Not sure I fully understand multipart/related. The one example I've
				 * seen, there were 3 parts: the main content, and 2 images as attachment.
				 * The main content was itself a multipart/alternative (from which we'd
				 * prefer to grab the HTML variant). I suspect the 2 images were images to
				 * be used in the HTML. Maybe it's so that you could fetch the e-mail and
				 * then view it offline with no Internet connectivity, but still have the
				 * images available?
				 *
				 * The one heuristic I could pick out is that the main message had no
				 * filename, while the two images had filenames (presumably so that the
				 * HTML could refer to them.
				 */
				const unnamedParts = messagePart.parts.filter(function(part) {
					return part.filename === '';
				}).filter(function(part) {
					if (/image\/.+/.exec(part.mimeType)) {
						return false; // Definitely don't pick images.
					}
					switch (part.mimeType) {
						default: return true; //if not sure, keep it.
					}
				});
				logger.debug(util.format("Thread %s is multipart/related. Picking part with partId %s because it's the only one with no filename.", threadId, unnamedParts.partId));
				if (unnamedParts.length == 1) {
					return getBestBodyFromMessage(unnamedParts[0], threadId);
				}
				logger.error(util.format("Don't know how to decide between mimeTypes %s in thread %s.", unnamedParts.map(p => p.mimeType), threadId));
				return null;
			default:
				logger.error(util.format("Don't know how to handle mimeType %s in thread %s.", messagePart.mimeType, threadId));
				return null;
		}
	}
	(function test_getBestBodyFromMessage() {
		console.log("Running tests on getBestBodyFromMessage...");
		const badDecoded = "bad";
		const goodDecoded = "good";
		const badEncoded = mimelib.encodeBase64(badDecoded);
		const goodEncoded = mimelib.encodeBase64(goodDecoded);
		// If the message is in plain text/html, just return its body.
		assert.equal(
			getBestBodyFromMessage({
				mimeType: 'text/html',
				body: {
					size: 1,
					data: goodEncoded
				}
			}, ''),
			goodDecoded);
		//Don't take the attachment, even if it's the biggest item in there.
		assert.equal(
			getBestBodyFromMessage({
				mimeType: 'multipart/mixed',
				parts: [
					{
						mimeType: 'multipart/alternative',
						parts: [
							{
								mimeType: 'text/plain',
								body: {
									size: 10,
									data: badEncoded
								}
							}, {
								mimeType: 'text/html',
								body: {
									size: 100,
									data: goodEncoded
								}
							}
						]
					}, {
						mimeType: 'image/jpeg',
						body: {
							size: 1000,
							data: badEncoded
						}
					}
				]
			}, ''),
			goodDecoded
		);
		// If there are multiple alternatives, picks the larger message, all other factors equal.
		assert.equal(
			getBestBodyFromMessage({
				mimeType: 'multipart/alternative',
				parts: [
					{
						"mimeType": "text/html",
						body: {
							size: 10,
							data: goodEncoded
						}
					}, {
						"mimeType": "text/html",
						body: {
							size: 1,
							data: badEncoded
						}
					}
				]
			}, ''),
			goodDecoded
		);
		//If an embedded multipart/alternative is text/plain, don't forget to wrap that text/plain in a <pre>.
		assert.equal(
			getBestBodyFromMessage({
				mimeType: 'multipart/alternative',
				parts: [
					{
						"mimeType": "text/plain",
						body: {
							size: 10,
							data: goodEncoded
						}
					}
				]
			}, ''),
			'<pre>' + goodDecoded + '</pre>'
		);
	})();

	/**
	 * @return [String] uses heuristics to choose the "best" body out of all the
	 * mime parts available. The returned string will always be HTML formatted. So
	 * for example, if the best body is a text/plain, the returned string will be
	 * the that body wrapped in <pre></pre> tags.
	 */
	Message.prototype.bestBody = function() {
		return getBestBodyFromMessage(this._data.payload, this._data.threadId);
	}

	exports.Message = Message;
})();