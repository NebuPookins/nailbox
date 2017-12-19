const DEFAULT_CONFIG = {
	port: 3000
};
const PATH_TO_CONFIG = 'data/config.json';

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
const Optional = require('optional-js');
const helpers = {
	fileio: require('./helpers/fileio')
};
const models = {
	thread: require('./models/thread'),
	message: require('./models/message'),
	hideUntils: require('./models/hide_until'),
	lastRefreshed: require('./models/last_refreshed'),
};

function readConfigWithDefault(config, strFieldName) {
	if (config[strFieldName]) {
		return config[strFieldName];
	} else {
		return DEFAULT_CONFIG[strFieldName];
	}
}

logger.info("Checking directory structure...");
helpers.fileio.ensureDirectoryExists('data/threads').then(function() {
	return logger.info("Directory structure looks fine.");
}).then(function() {
	return q.all([
		helpers.fileio.readJsonFromOptionalFile(PATH_TO_CONFIG),
		models.hideUntils.load(),
		models.lastRefreshed.load(),
	]);
}).spread(function(config, hideUntils, lastRefresheds) {
	const app = express();
	app.set('views', path.join(__dirname, 'views'));
	app.set('view engine', 'jade');
	app.use('/public', express.static('public'));
	app.use(bodyParser.json({limit: '10mb', parameterLimit: 10000}));
	app.use(bodyParser.urlencoded({limit: '10mb', parameterLimit: 10000, extended: true }));
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
		helpers.fileio.saveJsonToFile(config, PATH_TO_CONFIG).then(function() {
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

	/**
	 * @param threadId [String] the thread to delete
	 * @param resultCallback [function] Callback function receive a boolean. True
	 * indicates that the deletion was successful, false indicates the deletion was
	 * unsuccessful.
	 */
	function deleteThread(threadId, resultCallback) {
		const pathToDelete = 'data/threads/' + threadId;
		nodeFs.unlink(pathToDelete, function(err) {
			if (err) {
				if (err.code === 'ENOENT') {
					//Files is already deleted; that's okay, delete is idempotent.
					logger.info(`File ${pathToDelete} already deleted.`);
					resultCallback(true);
				} else {
					logger.error(util.format("Error deleting %s. Code: %s. Stack: %s",
						pathToDelete, err.code, err.stack));
					resultCallback(false);
				}
			} else {
				logger.info(util.format("Deleted file %s", pathToDelete));
				resultCallback(true);
			}
		});
	}

	/**
	 * Records the existence of a thread. The client-side code periodically checks
	 * gmail for the 100 most recent threads, and performs a POST to this route
	 * to inform the backend the contents of those threads.
	 */
	app.post('/api/threads', function(req, res) {
		const threadId = req.body.id;
		if (typeof threadId === 'string' && threadId.match(/^[0-9a-z]+$/)) {
			const allMessagesInTrash = req.body.messages.every(
				(message) => message.labelIds.indexOf('TRASH') !== -1
			);
			if (allMessagesInTrash) {
				logger.info(`Deleting thread ${threadId} because all messages in thread are in trash.`);
				deleteThread(threadId, function(isSuccessful) {
					res.sendStatus(isSuccessful ? 200 : 500);
				});
			} else {
				nodeFs.writeFile('data/threads/' + threadId, JSON.stringify(req.body), function(err) {
				if (err) {
					logger.error(util.inspect(err));
					res.sendStatus(500);
				} else {
					res.sendStatus(200);
					lastRefresheds.markRefreshed(threadId).done();
				}
			});
			}
		} else {
			res.status(400).send({ humanErrorMessage: "invalid threadId" });
		}
	});

	/**
	 * Replies with a list of threads to show on the main page.
	 */
	app.get('/api/threads', function(req, res) {
		nodeFs.readdir('data/threads', function(err, filenames) {
			if (err) {
				logger.error(util.inspect(err));
				res.sendStatus(500);
			} else {
				var jsonResponse = {};
				const now = Date.now();
				q.all(filenames.map(function(filename) {
					return models.thread.get(filename).then(function(thread) {
						const maybeMostRecentSnippetInThread = thread.snippet();
						return {
							threadId: thread.id(),
							senders: thread.people(header => header.name === 'From'),
							receivers: thread.people(header => header.name === 'To'),
							lastUpdated: thread.lastUpdated(),
							subject: thread.subject(),
							snippet: maybeMostRecentSnippetInThread ? entities.decode(maybeMostRecentSnippetInThread) : null,
							messageIds: thread.messageIds(),
							labelIds: thread.labelIds(),
							visibility: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).getVisibility(thread.lastUpdated(), now),
							isWhenIHaveTime: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).isWhenIHaveTime(),
							needsRefreshing: lastRefresheds.needsRefreshing(thread.id(), thread.lastUpdated(), now),
						};
					}, function(e) {
						//If you couldn't read certain thread files, just keep proceeding.
						logger.warn(util.inspect(e));
						return null;
					});
				})).then(function (formattedThreads) {
					formattedThreads = formattedThreads
						.filter(formattedThread => formattedThread !== null)
						.filter(formattedThread => formattedThread.visibility !== 'hidden');
					formattedThreads.sort(hideUntils.comparator());
					formattedThreads.length = Math.min(formattedThreads.length, 100);
					res.status(200);
					res.type('json');
					res.send(formattedThreads);
				}).done();
			}
		});
	});

	app.delete(/^\/api\/threads\/([a-z0-9]+)$/, function(req, res) {
		const threadId = req.params[0];
		logger.info(util.format("Receive request to delete thread %s.", threadId));
		deleteThread(threadId, function(isSuccessful) {
			res.sendStatus(isSuccessful ? 200 : 500);
		});
	});

	app.put(/^\/api\/threads\/([a-z0-9]+)\/hideUntil$/, function(req, res) {
		const threadId = req.params[0];
		const hideUntil = req.body;
		var promiseHideUntilIsSaved;
		switch (hideUntil.type) {
			case 'timestamp':
				const hideUntilTimestamp = parseInt(hideUntil.value);
				logger.info(`Hiding thread ${threadId} until timestamp ${hideUntilTimestamp}.`);
				promiseHideUntilIsSaved = hideUntils.hideUntilTimestamp(threadId, hideUntilTimestamp);
				break;
			case 'when-i-have-time':
				logger.info(`Hiding thread ${threadId} until I have time.`);
				promiseHideUntilIsSaved = hideUntils.hideUntilIHaveTime(threadId);
				break;
			default:
				logger.error(`Don't know how to handle hideUntil.type ${hideUntil.type}.`);
				res.status(400).send("Invalid hideUntil.type");
				return;
		}
		promiseHideUntilIsSaved.then(function() {
			res.sendStatus(200);
		}, function(err) {
			logger.error(util.format("Failed to save hideUntils: %j", err));
			res.sendStatus(500);
		});
		return;
	});

	function loadRelevantDataFromMessage(objMessage) {
		const originalBody = objMessage.bestBody();
		const attachments = objMessage.getAttachments();
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
				},
				'*': function(tagName, attribs) {
					if ((typeof attribs.style) === 'string') {
						attribs.style = attribs.style.replace(/position: *absolute;/, '');
						return {
							tagName: tagName,
							attribs: attribs
						};
					} else {
						return {
							tagName: tagName,
							attribs: attribs
						};
					}
				}
			},
			allowedTags: [
				"a", "area", "b", "blockquote", "br", "caption", "center", "code",
				"div", "em",
				"h1", "h2", "h3", "h4", "h5", "h6",
				"hr", "i", "img", "li", "map", "nl", "ol", "p", "pre", 'span',
				"strike", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"],
			allowedAttributes: {
				a: [ 'href', 'name', 'style', 'target' ],
				area: ['href', 'shape', 'coords', 'style', 'target'],
				div: ['style'],
				img: [ 'alt', 'border', 'height', 'src', 'style', 'usemap', 'width' ],
				map: ['name'],
				p: ['style'],
				span: ['style'],
				table: ['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'style', 'width'],
				td: ['align', 'background', 'bgcolor', 'colspan', 'height', 'rowspan', 'style', 'valign', 'width'],
			},
			nonTextTags: [ 'style', 'script', 'textarea', 'title' ]
		});
		return {
			deleted: objMessage.labelIds().indexOf('TRASH') !== -1,
			messageId: objMessage.id(),
			from: [objMessage.sender()], //TODO: Fix contract so this is no longer an array
			to: objMessage.recipients(),
			date: objMessage.timestamp(),
			body: {
				original: originalBody,
				sanitized: sanitizedBody
			},
			attachments: attachments
		};
	}

	app.get(/^\/api\/threads\/([a-z0-9]+)\/messages$/, function(req, res) {
		const threadId = req.params[0];
		models.thread.get(threadId).then(function(thread) {
			res.status(200).send({
				messages: thread.messages().map(loadRelevantDataFromMessage)
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
		models.thread.get(threadId).then(function(thread) {
			const matchingMessage = thread.message(messageId);
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
		const missingFields = ['threadId', 'body', 'inReplyTo', 'myEmail'].filter((requiredField) => {
			return !req.body[requiredField];
		});
		if (missingFields.length > 0) {
			res.status(400).send(util.format("Must provide %j", missingFields));
			return;
		}
		logger.info(util.format("/api/rfc2822 received for thread %s", req.body.threadId));
		const bodyPlusSignature = req.body.body + "\n\n---\nSent using [Nailbox](https://github.com/NebuPookins/nailbox/).";
		models.thread.get(req.body.threadId).then(thread => {
			if (!thread.message(req.body.inReplyTo)) {
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
						resolve([thread, content]);
					}
				});
			});
		}).spread((thread, htmlizedMarkdown) => {
			const mostRecentMessage = thread.mostRecentMessageSatisfying(() => true);
			const receivers = mostRecentMessage.recipients();
			const peopleOtherThanYourself = _.uniqBy(
				receivers.concat(mostRecentMessage.replyTo())
					.filter(person => person.email !== req.body.myEmail),
				recipient => recipient.email
			);
			const toLine = peopleOtherThanYourself.map(person => util.format("%s <%s>", person.name, person.email));
			const inReplyToId = Optional.ofNullable(mostRecentMessage.header('Message-ID'))
				.map((header) => header.value)
				.orElse(null)
			const mail = mailcomposer({
				from: req.body.myEmail,
				to: peopleOtherThanYourself.map(person => util.format("%s <%s>", person.name, person.email)),
				inReplyTo: inReplyToId,
				subject: thread.subject(),
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
