const DEFAULT_CONFIG = {
	port: 3000
};
const PATH_TO_CONFIG = 'data/config.json';
const PATH_TO_HIDE_UNTILS = 'data/hideUntils.json';

const util = require('util');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const logger = require('nebulog').make({filename: __filename, level: 'debug'});
const nodeFs = require('node-fs');
const q = require('q');
const assert = require('assert');
const _ = require('lodash');
const mimelib = require("mimelib");
const sanitizeHtml = require('sanitize-html');
const Entities = require('html-entities').AllHtmlEntities;
const entities = new Entities();
const mailcomposer = require("mailcomposer");
const marked = require('marked');
const base64url = require('base64url');
const pygmentizeBundled = require('pygmentize-bundled');

/**
 * Returns a promise. If the promise resolves successfully, then as a side
 * effect the specified directory exists on the filesystem.
 */
function ensureDirectoryExists(dir) {
	return q.Promise(function(resolve, reject) {
		const recursive = true;
		nodeFs.mkdir(dir, 0700, recursive, function(err) {
			if (err) {
				reject(err);
			} else {
				resolve(dir);
			}
		});
	});
}

function readConfigWithDefault(config, strFieldName) {
	if (config[strFieldName]) {
		return config[strFieldName];
	} else {
		return DEFAULT_CONFIG[strFieldName];
	}
}

function saveJsonToFile(json, path) {
	return q.Promise(function(resolve, reject) {
		nodeFs.writeFile(path, JSON.stringify(json), function(err) {
			if (err) {
				reject(err);
			} else {
				resolve(json);
			}
		});
	});
}

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

function recipientsInThread(threadData) {
	return peopleInThread(threadData, function(header) {
		return header.name === 'To';
	});
}

function sendersInThread(threadData) {
	return peopleInThread(threadData, function(header) {
		return header.name === 'From';
	});
}

function threadLastUpdated(threadData) {
	return _.max(
		threadData.messages.map(function(message) {
			return parseInt(message.internalDate);
		})
	);
}

/**
 * Returns all headers in the given message with the given name. Under normal
 * circumstances, the message will have either 0 or 1 headers with a given
 * name.
 */
function headersInMessage(headerName, message) {
	return message.payload.headers
		.filter(header => header.name === headerName);
}

/**
 * @return the message object, or null if no message satisfies the predicate.
 */
function mostRecentMessageSatisfying(threadData, fnMessagePredicate) {
	const satisfyingMessages = threadData.messages.filter(fnMessagePredicate);
	if (satisfyingMessages.length === 0) {
		return null;
	}
	return _.maxBy(satisfyingMessages, message => parseInt(message.internalDate));
}

function mostRecentSubjectInThread(threadData) {
	const newestMessageWithSubject = mostRecentMessageSatisfying(threadData, function(message) {
		return ! _.isEmpty(headersInMessage('Subject', message));
	});
	if (newestMessageWithSubject == null) {
		logger.warn(util.format("Thread %s has no messages with subject. Can that actually happen?", threadData.id));
		return null;
	}
	return headersInMessage('Subject', newestMessageWithSubject)[0].value;
}

/**
 * @return the message object, or null if no messages have snippets.
 */
function mostRecentSnippetInThread(threadData) {
	const newestMessageWithSnippet = mostRecentMessageSatisfying(threadData, function(message) {
		return message.snippet;
	});
	return newestMessageWithSnippet ? newestMessageWithSnippet.snippet : null;
}

/**
 * @return an array that looks like:
 * [
 *   { name: 'Alfred Alpha', email: 'aa@gmail.com'},
 *   { name: '"Beta, Betty"', email: 'bb@gmail.com'}
 * ]
 */
function peopleInThread(threadData, fnFilter) {
	if (fnFilter === undefined) {
		fnFilter = () => true;
	}
	const recipients = threadData.messages.map(function(message) {
		return emailAddressesInMessage(message, fnFilter);
	}).reduce((a, b) => a.concat(b)); //Flatten the array of arrays.
	return _.uniqBy(recipients, recipient => recipient.email);
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
function emailAddressesInMessage(message, fnHeaderFilter) {
	return message.payload.headers
		.filter(fnHeaderFilter)
		.map(header => parseEmailToString(header.value))
		.reduce((a, b) => a.concat(b), []); //Flatten the array of arrays.
}

function readThreadFromFile(threadId) {
	return q.Promise(function(resolve, reject) {
		nodeFs.readFile('data/threads/' + threadId, function(err, strFileContents) {
			if (err) {
				return reject(err);
			} else {
				var jsonFileContents;
				try {
					jsonFileContents = JSON.parse(strFileContents);
				} catch (e) {
					if (e instanceof SyntaxError) {
						logger.warn(util.format("Failed to parse JSON from %s", threadId));
					}
					return reject(e);
				}
				return resolve(jsonFileContents);
			}
		});
	});
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
			return '<pre>' + mimelib.decodeBase64(messagePart.body.data) + '</pre>';
		case 'text/html':
			return mimelib.decodeBase64(messagePart.body.data);
		case 'multipart/alternative':
			const biggestPart = _.maxBy(messagePart.parts, part => parseInt(part.body.size));
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
				return part.filename === ''
			});
			if (unnamedParts.length == 1) {
				return getBestBodyFromMessage(unnamedParts[0], threadId);
			}
			logger.error(util.format("Don't know how to decide between mimeTypes %s in thread %s.", nonAttachments.map(p => p.mimeType), threadId));
			return null;
		default:
			logger.error(util.format("Don't know how to handle mimeType %s in thread %s.", messagePart.mimeType, threadId));
			return null;
	}
}
(function test_getBestBodyFromMessage() {
	const badDecoded = "bad";
	const goodDecoded = "good";
	const badEncoded = mimelib.encodeBase64(badDecoded);
	const goodEncoded = mimelib.encodeBase64(goodEncoded);
	assert.equal(
		getBestBodyFromMessage({
			mimeType: 'text/html',
			body: {
				size: 1,
				data: goodEncoded
			}
		}, ''),
		goodEncoded,
		"If the message is in plain text/html, just return its body."
		);
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
		goodEncoded,
		"Don't take the attachment, even if it's the biggest item in there."
	);
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
		goodEncoded,
		"If there are multiple alternatives, picks the larger message, all other factors equal."
	);
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
		'<pre>' + goodEncoded + '</pre>',
		"If an embedded multipart/alternative is text/plain, don't forget to wrap that text/plain in a <pre>."
	);
})();

function readJsonFromOptionalFile(path) {
	return q.Promise(function(resolve, reject) {
		nodeFs.readFile(path, function(err, strFileContents) {
			if (err) {
				if (err.code === 'ENOENT') {
					logger.info(util.format("No file found at %s, using empty json by default.", path));
					resolve({});
				} else {
					reject(err);
				}
			} else {
				resolve(JSON.parse(strFileContents));
			}
		});
	});
}

/**
 * Returns a comparator (function) that sorts messages so that "newer" ones
 * show up near the top, a message timestamp-hidden to 2015-jan-01 is treated as
 * if it was lastUpdated on 2015-jan-01. Messages that are hidden "until I have
 * time" are sorted last.
 *
 * The returned function takes 2 params and expects them to be objects with
 * properties "threadId" and "lastUpdated".
 */
function createComparatorForThreadsForMainView(hideUntils) {
	return (a, b) => {
		var hideAUntil = hideUntils[a.threadId] || {type: 'none'};
		var hideBUntil = hideUntils[b.threadId] || {type: 'none'};
		switch (hideAUntil.type) {
			case 'when-i-have-time':
				switch (hideBUntil.type) {
					case 'when-i-have-time':
						return hideBUntil.hiddenOn - hideAUntil.hiddenOn;
					case 'timestamp':
						return 1;
					case 'none':
						return 1;
					default:
						logger.error(util.format("Don't know how to sort with hideBUntil.type == %s", hideAUntil.type));
						return 0;
				}
			case 'timestamp':
				switch (hideBUntil.type) {
					case 'when-i-have-time':
						return -1;
					case 'timestamp':
						return hideBUntil.value - hideAUntil.value;
					case 'none':
						return b.lastUpdated - hideAUntil.value;
					default:
						logger.error(util.format("Don't know how to sort with hideBUntil.type == %s", hideAUntil.type));
						return 0;
				}
			case 'none':
				switch (hideBUntil.type) {
					case 'when-i-have-time':
						return -1;
					case 'timestamp':
						return hideBUntil.value - a.lastUpdated;
					case 'none':
						return b.lastUpdated - a.lastUpdated;
					default:
						logger.error(util.format("Don't know how to sort with hideBUntil.type == %s", hideAUntil.type));
						return 0;
				}
			default:
				logger.error(util.format("Don't know how to sort with hideAUntil.type == %s", hideAUntil.type));
				return 0;
		}
	}
}

logger.info("Checking directory structure...");
ensureDirectoryExists('data/threads').then(function() {
	return logger.info("Directory structure looks fine.");
}).then(function() {
	return q.all([
		readJsonFromOptionalFile(PATH_TO_CONFIG),
		readJsonFromOptionalFile(PATH_TO_HIDE_UNTILS)
	]);
}).spread(function(config, hideUntils) {
	const app = express();
	app.set('views', path.join(__dirname, 'views'));
	app.set('view engine', 'jade');
	app.use('/public', express.static('public'));
	app.use(bodyParser.json({limit: '10mb', parameterLimit: 5000}));
	app.use(bodyParser.urlencoded({limit: '10mb', parameterLimit: 5000, extended: true }));
	app.use(function (req, res, next) {
		//Log each request.
		logger.info(util.format("%s %s => %s %s %s", new Date().toISOString(), req.ip, req.protocol, req.method, req.url));
		next();
	});

	app.get('/', function(req, res) {
		const clientId = readConfigWithDefault(config, 'clientId');
		if (typeof clientId === 'string') {
			res.render('index');
		} else {
			res.redirect('/setup');
		}
	});

	app.get('/setup', function(req, res) {
		res.render('setup', {clientId: config.clientId});
	});

	app.post('/setup', function(req, res) {
		logger.info(util.format("Updating client ID to '%s'.", req.body.clientId));
		config.clientId = req.body.clientId;
		saveJsonToFile(config, PATH_TO_CONFIG).then(function() {
			res.redirect('/setup');
		}, function(err) {
			logger.error(util.format("Failed to save config file: %s", util.inspect(err)));
			res.sendStatus(500);
		}).done();
	});

	app.get('/api/clientId', function(req, res) {
		const clientId = readConfigWithDefault(config, 'clientId');
		if (typeof clientId === 'string') {
			res.status(200).send(config.clientId);
		} else {
			res.sendStatus(404);
		}
	});

	app.post('/api/threads', function(req, res) {
		const threadId = req.body.id;
		if (typeof threadId === 'string' && threadId.match(/^[0-9a-z]+$/)) {
			nodeFs.writeFile('data/threads/' + threadId, JSON.stringify(req.body), function(err) {
				if (err) {
					logger.error(util.inspect(err));
					res.sendStatus(500);
				} else {
					res.sendStatus(200);
				}
			});
		} else {
			res.status(400).send({ humanErrorMessage: "invalid threadId" });
		}
	});

	app.get('/api/threads', function(req, res) {
		nodeFs.readdir('data/threads', function(err, filenames) {
			if (err) {
				logger.error(util.inspect(err));
				res.sendStatus(500);
			} else {
				var jsonResponse = {};
				q.all(filenames.map(function(filename) {
					return readThreadFromFile(filename).then(function(threadData) {
						const maybeMostRecentSnippetInThread = mostRecentSnippetInThread(threadData);
						return {
							threadId: threadData.id,
							senders: sendersInThread(threadData),
							receivers: recipientsInThread(threadData),
							lastUpdated: threadLastUpdated(threadData),
							subject: mostRecentSubjectInThread(threadData),
							snippet: maybeMostRecentSnippetInThread ? entities.decode(maybeMostRecentSnippetInThread) : null,
							messageIds: threadData.messages.map(message => message.id),
							labelIds: _.uniq(threadData.messages
								.map(message => message.labelIds)
								.reduce((a, b) => a.concat(b))) //Flatten the array of arrays.
						};
					}, function(e) {
						//If you couldn't read certain thread files, just keep proceeding.
						return null;
					});
				})).then(function (files) {
					var now = Date.now();
					files = files
						.filter(file => file !== null)
						.filter(function hideMessagesForLater(file) {
							var hideUntil = hideUntils[file.threadId];
							if (!hideUntil) {
								return true;
							}
							if (hideUntil.type === 'timestamp') {
								return hideUntil.value < now;
							}
							return true;
						});
					files.sort(createComparatorForThreadsForMainView(hideUntils));
					res.status(200);
					res.type('json');
					res.send(files);
				}).done();
			}
		});
	});

	app.delete(/^\/api\/threads\/([a-z0-9]+)$/, function(req, res) {
		const threadId = req.params[0];
		logger.info(util.format("Receive request to delete thread %s.", threadId));
		const pathToDelete = 'data/threads/' + threadId;
		nodeFs.unlink(pathToDelete, function(err) {
			if (err) {
				if (err.code === 'ENOENT') {
					//Files is already deleted; that's okay, delete is idempotent.
					res.sendStatus(200);
				} else {
					logger.error(util.format("Error deleting %s. Code: %s. Stack: %s",
						pathToDelete, err.code, err.stack));
					res.sendStatus(500);
				}
			} else {
				logger.info(util.format("Deleted file %s", pathToDelete));
				res.sendStatus(200);
			}
		});
	});

	app.put(/^\/api\/threads\/([a-z0-9]+)\/hideUntil$/, function(req, res) {
		const threadId = req.params[0];
		const hideUntil = req.body;
		switch (hideUntil.type) {
			case 'timestamp':
				var hideUntilTimestamp = parseInt(hideUntil.value);
				logger.info(util.format("Hiding thread %s until timestamp %j", threadId, hideUntilTimestamp));
				hideUntils[threadId] = {
					type: 'timestamp',
					value: hideUntilTimestamp
				};
				saveJsonToFile(hideUntils, PATH_TO_HIDE_UNTILS).then(function() {
					res.sendStatus(200);
				}, function(err) {
					logger.error(util.format("Failed to save hideUntils: %j", err));
					res.sendStatus(500);
				});
				return;
			case 'when-i-have-time':
				logger.info(util.format("Hiding thread %s until I have time", threadId));
				hideUntils[threadId] = {
					type: 'when-i-have-time',
					hiddenOn: Date.now(),
				};
				saveJsonToFile(hideUntils, PATH_TO_HIDE_UNTILS).then(function() {
					res.sendStatus(200);
				}, function(err) {
					logger.error(util.format("Failed to save hideUntils: %j", err));
					res.sendStatus(500);
				});
				return;
			default:
				logger.error(util.format("Don't know how to handle hideUntil.type %s", hideUntil.type));
				res.status(400).send("Invalid hideUntil.type");
		}
	});

	function loadRelevantDataFromMessage(objMessage) {
		const originalBody = getBestBodyFromMessage(objMessage.payload, objMessage.threadId);
		const sanitizedBody = sanitizeHtml(originalBody, {
			transformTags: {
				'body': 'div',
				'a': function(tagName, attribs) {
					//All links in messages should open in a new tab.
					if (attribs.href) {
						attribs.target = '_blank';
					}
					return {
						tagName: 'a',
						attribs: attribs
					};
				}
			},
			allowedTags: [
				"a", "b", "blockquote", "br", "caption", "center", "code", "div", "em",
				"h1", "h2", "h3", "h4", "h5", "h6",
				"hr", "i", "img", "li", "nl", "ol", "p", "pre", 'span', "strike", "strong",
				"table", "tbody", "td", "th", "thead", "tr", "ul"],
			allowedAttributes: {
				a: [ 'href', 'name', 'style', 'target' ],
				div: ['style'],
				img: [ 'alt', 'border', 'height', 'src', 'style', 'width' ],
				p: ['style'],
				span: ['style'],
				table: ['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'style', 'width'],
				td: ['align', 'background', 'bgcolor', 'colspan', 'height', 'rowspan', 'style', 'valign', 'width'],
			},
			nonTextTags: [ 'style', 'script', 'textarea', 'title' ]
		});
		return {
			deleted: objMessage.labelIds.indexOf('TRASH') !== -1,
			messageId: objMessage.id,
			from: emailAddressesInMessage(
				objMessage, header => header.name === 'From'),
			to: emailAddressesInMessage(
				objMessage, header => header.name === 'To'),
			date: parseInt(objMessage.internalDate),
			body: {
				original: originalBody,
				sanitized: sanitizedBody
			}
		};
	}

	app.get(/^\/api\/threads\/([a-z0-9]+)\/messages$/, function(req, res) {
		const threadId = req.params[0];
		readThreadFromFile(threadId).then(function(threadData) {
			res.status(200).send({
				messages: threadData.messages.map(loadRelevantDataFromMessage)
			});
		}, function(err) {
			if (err.code === 'ENOENT') {
				res.sendStatus(404);
			} else {
				logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
				res.sendStatus(500);
			}
		}).done();
	});

	app.get(/^\/api\/threads\/([a-z0-9]+)\/messages\/([a-z0-9]+)$/, function(req, res) {
		const threadId = req.params[0];
		const messageId = req.params[1];
		readThreadFromFile(threadId).then(function(threadData) {
			const matchingMessage = threadData.messages.find(function(message) {
				return message.id === messageId;
			});
			if (matchingMessage) {
				res.status(200).send(loadRelevantDataFromMessage(matchingMessage));
			} else {
				res.sendStatus(404);
			}
			
		}, function(err) {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}).done();
	});

	/**
	 * Conceptually, this really should be an idempotent GET operation. You give
	 * a JSON describing an e-mail, with the body in Markdown format. It then
	 * generates the base64url encoded stream of characters which, when decoded, is
	 * an RFC 2822 compliant e-mail ready to be sent to an SMTP server. The reason
	 * we're using POST instead of GET here is that GET has a max query limit.
	 */
	app.post('/api/rfc2822', (req, res) => {
		var missingFields = ['threadId', 'body', 'inReplyTo', 'myEmail'].filter((requiredField) => {
			return !req.body[requiredField];
		})
		if (missingFields.length > 0) {
			res.status(400).send(util.format("Must provide %j", missingFields));
			return;
		}
		logger.info(util.format("/api/rfc2822 received for thread %s", req.body.threadId));
		const bodyPlusSignature = req.body.body + "\n\n---\nSent using [Nailbox](https://github.com/NebuPookins/nailbox/).";
		readThreadFromFile(req.body.threadId).then(threadData => {
			var messageInReplyTo = threadData.messages.find(message => {
				return message.id == req.body.inReplyTo;
			});
			if (!messageInReplyTo) {
				throw {
					status: 400,
					message: util.format("Could not find message %s in thread %s", req.body.inReplyTo, req.body.threadId)
				};
			}
			return q.Promise((resolve, reject) => {
				marked(bodyPlusSignature, {
					gfm: true,
					tables: true,
					breaks: true,
					smartLists: true,
					smartypants: true,
					highlight: (code, lang, callback) => {
						pygmentizeBundled({
							lang: lang,
							format: 'html',
							options: {
								noclasses: true,
								nowrap: true //marked already adds a <pre> tag; no need to double wrap it.
							}
						}, code, (err, result) => {
							callback(err, result.toString());
						});
					}
				}, (err, content) => {
					if (err) {
						reject(err);
					} else {
						resolve([threadData, content]);
					}
				});
			});
		}).spread((threadData, htmlizedMarkdown) => {
			const mostRecentMessage = mostRecentMessageSatisfying(threadData, () => true);
			const senders = emailAddressesInMessage(mostRecentMessage, header => header.name === 'From');
			const receivers = emailAddressesInMessage(mostRecentMessage, header => header.name === 'From');
			const peopleOtherThanYourself = _.uniqBy(
				senders.concat(receivers)
					.filter(person => person.email !== req.body.myEmail),
				recipient => recipient.email
			);
			const toLine = peopleOtherThanYourself.map(person => util.format("%s <%s>", person.name, person.email));
			const mail = mailcomposer({
				from: req.body.myEmail,
				to: peopleOtherThanYourself.map(person => util.format("%s <%s>", person.name, person.email)),
				inReplyTo: req.body.inReplyTo,
				subject: mostRecentSubjectInThread(threadData),
				text: bodyPlusSignature,
				html: util.format('<!DOCTYPE html><html><head>'+
					'<style type="test/css">blockquote {padding: 10px 20px;margin: 0 0 20px; border-left: 5px solid #eee;}</style>'+
					'</head><body>%s</body></html>', htmlizedMarkdown)
			});
			return q.Promise((resolve, reject) => {
				mail.build((err, message) => {
					if (err) {
						logger.error(util.format("Failed to compose mail %j", err));
						return reject({
							status: 500,
							message: ''
						});
					}
					return resolve(message);
				});
			});
		}).then((resp) => {
			res.status(200).send(base64url.encode(resp));
		}, (failResp) => {
			if (failResp.status && failResp.message) {
				res.status(failResp.status).send(failResp.message);
			} else {
				logger.error(util.inspect(failResp));
				res.sendStatus(500);
			}
		}).done();
	});

	app.use(function(req, res) {
		logger.debug(util.format("Sent 404 in response to %s %s", req.method, req.url));
		res.sendStatus(404);
	});

	app.use(function(err, req, res, next) {
		logger.error(err.stack);
		res.sendStatus(500);
	});

	app.listen(readConfigWithDefault(config, 'port'));
	logger.info(util.format("Nailbox is running on port %d.", readConfigWithDefault(config, 'port')));
}).done();
