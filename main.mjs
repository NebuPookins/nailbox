const DEFAULT_CONFIG = {
	port: 3000
};
const PATH_TO_CONFIG = 'data/config.json';

import assert from 'assert';
import util from 'util';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import nebulog from 'nebulog';
const logger = nebulog.make({filename: 'main.mjs', level: 'debug'});
import nodeFs from 'node-fs';
import nodeFsPromises from 'node:fs/promises';
import q from 'q';
import _ from 'lodash';
import sanitizeHtml from 'sanitize-html';
import htmlEntities from 'html-entities';
const Entities = htmlEntities.AllHtmlEntities;
const entities = new Entities();
import mailcomposer from 'mailcomposer';
import { marked } from 'marked';
import base64url from 'base64url';
import hljs from 'highlight.js';
import posthtml from 'posthtml';
import Optional from 'optional-js';
import helpers_fileio from './helpers/fileio.js';

import models_thread from './models/thread.js';
import models_message from './models/message.js';
import models_hideUntils from './models/hide_until.js';
import models_lastRefreshed from './models/last_refreshed.js';

import emailGrouper from './email-grouper.js';

/*
 * Set up graceful exit, because otherwise there's a race condition
 * where the process might be killed in the middle of IO, which will
 * result in corrupt JSON files.
 */
process.on('SIGINT', () => {
	console.log("\n"); //Print newline because CTRL-C usually causes "^C" to get printed to the terminal, and we want the next log message to be on its own line.
	logger.info("Gracefully shutting down from SIGINT (Ctrl-C)...");
	process.exit( );
});

function readConfigWithDefault(config, strFieldName) {
	if (config[strFieldName]) {
		return config[strFieldName];
	} else {
		return DEFAULT_CONFIG[strFieldName];
	}
}

logger.info("Checking directory structure...");
await helpers_fileio.ensureDirectoryExists('data/threads');
logger.info("Directory structure looks fine.");
const [config, hideUntils, lastRefresheds] = await Promise.all([
	helpers_fileio.readJsonFromOptionalFile(PATH_TO_CONFIG),
	models_hideUntils.load(),
	models_lastRefreshed.load(),
]);

const app = express();
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'pug');
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
	helpers_fileio.saveJsonToFile(config, PATH_TO_CONFIG).then(function() {
		res.redirect('/setup');
	}, function(err) {
		logger.error(util.format("Failed to save config file: %s", util.inspect(err)));
		res.sendStatus(500);
	}).done();
});

app.get('/api/clientId', function(req, res) {
	const clientId = readConfigWithDefault(config, 'clientId');
	if (typeof clientId === 'string') {
		res
			.status(200)
			.set('Content-Type', 'text/plain')
			.send(config.clientId);
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
 * Returns a promise with the N most relevant threads (newly received threads,
 * and snoozed threads whose snooze have expired, etc.). Specifically, returns
 * an array of objects.
 */
async function getNMostRelevantThreads(n) {
	const filenames = await nodeFsPromises.readdir('data/threads');
	const now = Date.now();
	let formattedThreads = await Promise.all(filenames.map(async (filename) => {
		try {
			const thread = await models_thread.get(filename);
			const maybeMostRecentSnippetInThread = thread.snippet();
			assert((typeof thread.id()) === 'string', `Expected thread.id() to be a string but was ${typeof thread.threadId} for file ${filename}.`);
			return {
				threadId: thread.id(),
				senders: thread.senders(),
				receivers: thread.recipients(),
				lastUpdated: thread.lastUpdated(),
				subject: thread.subject(),
				snippet: maybeMostRecentSnippetInThread ? entities.decode(maybeMostRecentSnippetInThread) : null,
				messageIds: thread.messageIds(),
				labelIds: thread.labelIds(),
				visibility: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).getVisibility(thread.lastUpdated(), now),
				isWhenIHaveTime: hideUntils.get({threadId: thread.id(), lastUpdated: thread.lastUpdated()}).isWhenIHaveTime(),
				needsRefreshing: lastRefresheds.needsRefreshing(thread.id(), thread.lastUpdated(), now),
			};
		} catch (e) {
			logger.warn("Couldn't read certain threads in getNMostrElevantThreads. Ignoring and continuing. ", util.inspect(e));
			return null;
		}
	}));
	formattedThreads = formattedThreads
		.filter(formattedThread => formattedThread !== null)
		.filter(formattedThread => formattedThread.visibility !== 'hidden');
	formattedThreads.sort(hideUntils.comparator());
	formattedThreads.length = Math.min(formattedThreads.length, 100);
	return formattedThreads;
}

/**
 * Replies with a list of threads to show on the main page.
 */
app.get('/api/threads', async function(req, res) {
	try {
		const formattedThreads = await getNMostRelevantThreads(100);
		res.status(200);
		res.type('application/json');
		res.send(formattedThreads);
	} catch (err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
});

/**
 * Replies with a list of threads to show on the main page, but grouped by
 * categories
 */
app.get('/api/threads/grouped', async function(req, res) {
	const groupPredicates = emailGrouper.predicateMap;
	try {
		const allThreads = await getNMostRelevantThreads(100);
		var groupedThreads = {};
		const whenIHaveTimeSuffix = " - When I Have Time";
		const groupNames = Object.keys(groupPredicates);
		function addToGroupedThreads(group, thread) {
			const key = (thread.visibility === 'when-i-have-time') ? `${group}${whenIHaveTimeSuffix}` : group;
			if (!Array.isArray(groupedThreads[key])) {
				groupedThreads[key] = [];
			}
			groupedThreads[key].push(thread);
		}
		allThreads.forEach((thread) => {
			var foundAGroup = false;
			for (let name of groupNames) {
				if (typeof groupPredicates[name] !== 'function') {
					logger.error(`groupPredicates[${name}] was a ${groupPredicates[name]} instead of a function.`);
				}
				if ((groupPredicates[name])(thread)) {
					addToGroupedThreads(name, thread);
					foundAGroup = true;
					break;
				}
			}
			if (!foundAGroup) {
				addToGroupedThreads("Others", thread);
			}
		});
		var orderedGroupThreads = [];
		Object.keys(groupedThreads).forEach((group) => {
			orderedGroupThreads.push({
				label: group,
				threads: groupedThreads[group]
			});
		});
		/*
			* Sort groups by their "newest" message; threads is guaranteed non-empty
			* from previous step.
			*/
		const hideUntilComparator = hideUntils.comparator();
		orderedGroupThreads.sort((groupA, groupB) => {
			return hideUntilComparator(groupA.threads[0], groupB.threads[0]);
		});
		const groupPriority = emailGrouper.groupPriority || {};
		orderedGroupThreads.sort((groupA, groupB) => {
			const BFirst = 1;
			const AFirst = -1;
			let labelA = groupA.label.replace(whenIHaveTimeSuffix, "");
			let labelB = groupB.label.replace(whenIHaveTimeSuffix, "");
			let whenIHaveTimeA = labelA != groupA.label;
			let whenIHaveTimeB = labelB != groupB.label;
			if (whenIHaveTimeA && !whenIHaveTimeB) {
				return BFirst;
			}
			if (!whenIHaveTimeA && whenIHaveTimeB) {
				return AFirst;
			}
			//assert whenIHaveTimeA == whenIHaveTimeB;
			if (groupPriority[labelA]) {
				if (groupPriority[labelB]) {
					return groupPriority[labelA] - groupPriority[labelB];
				} else {
					return BFirst;
				}
			} else {
				if (groupPriority[labelB]) {
					return AFirst;
				} else {
					return 0;
				}
			}
		});
		res.status(200);
		res.type('application/json');
		res.send(orderedGroupThreads);
	} catch(err) {
		logger.error(util.inspect(err));
		res.sendStatus(500);
	}
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
	const plainTextBody = sanitizeHtml(originalBody, {
		allowedTags: [],
		allowedAttributes: {}
	});
	const wordCount = plainTextBody.split(' ').length;
	const timeToReadSeconds = wordCount * 60 / 200;
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
			sanitized: sanitizedBody,
			plainText: plainTextBody,
		},
		wordcount: plainTextBody.split(' ').length,
		timeToReadSeconds: timeToReadSeconds,
		attachments: attachments
	};
}

app.get(/^\/api\/threads\/([a-z0-9]+)\/messages$/, function(req, res) {
	const threadId = req.params[0];
	models_thread.get(threadId).then(function(thread) {
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
	models_thread.get(threadId).then(function(thread) {
		const matchingMessage = thread.message(messageId);
		if (matchingMessage) {
			res.status(200).send(loadRelevantDataFromMessage(matchingMessage));
		} else {
			res.sendStatus(404);
		}
	}, function(err) {
		if (err.code === 'ENOENT') {
			res.sendStatus(404);
		} else {
			logger.error(util.format("Failed to read thread data: %s", util.inspect(err)));
			res.sendStatus(500);
		}
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
	models_thread.get(req.body.threadId).then(thread => {
		if (!thread.message(req.body.inReplyTo)) {
			throw {
				status: 400,
				message: util.format("Could not find message %s in thread %s", req.body.inReplyTo, req.body.threadId)
			};
		}
		return q.Promise((resolve, reject) => {
			marked.parse(bodyPlusSignature, {
				gfm: true,
				tables: true, //TODO: This no longer works as of marked 4?
				breaks: true,
				smartLists: true,
				smartypants: true, //smart quotes, dashes, etc.
				highlight: (code, lang) => {
					const htmlWithClasses = lang ?
						hljs.highlight(code, {language: lang, ignoreIllegals: true}).value :
						hljs.highlightAuto(code).value ;
					return posthtml()
						.use((tree) => {
							//Convert HLJS's CSS classes into inline styles.
							for (const [key, value] of Object.entries({
								'hljs-comment': 'color:#586e75',
								'hljs-quote': 'color:#586e75',
								'hljs-addition': 'color:#859900',
								'hljs-keyword': 'color:#859900',
								'hljs-selector-tag': 'color:#859900',
								'hljs-doctag': 'color:#2aa198',
								'hljs-literal'              : 'color:#2aa198',
								'hljs-meta hljs-meta-string': 'color:#2aa198', //TODO
								'hljs-number'               : 'color:#2aa198',
								'hljs-regexp'               : 'color:#2aa198',
								'hljs-string'               : 'color:#2aa198',
								'hljs-name' : 'color:#268bd2',
								'hljs-section' : 'color:#268bd2',
								'hljs-selector-class' : 'color:#268bd2',
								'hljs-selector-id' : 'color:#268bd2',
								'hljs-title' : 'color:#268bd2',
								'hljs-attr' : 'color:#b58900',
								'hljs-attribute' : 'color:#b58900',
								'hljs-class hljs-title' : 'color:#b58900', //TODO
								'hljs-template-variable' : 'color:#b58900',
								'hljs-type' : 'color:#b58900',
								'hljs-variable' : 'color:#b58900',
								'hljs-bullet' : 'color:#cb4b16',
								'hljs-link' : 'color:#cb4b16',
								'hljs-meta' : 'color:#cb4b16',
								'hljs-meta hljs-keyword' : 'color:#cb4b16',
								'hljs-selector-attr' : 'color:#cb4b16',
								'hljs-selector-pseudo' : 'color:#cb4b16',
								'hljs-subst' : 'color:#cb4b16',
								'hljs-symbol' : 'color:#cb4b16',
								'hljs-built_in' : 'color:#dc322f',
								'hljs-deletion' : 'color:#dc322f',
								'hljs-formula' : 'background:#073642',
								'hljs-emphasis' : 'font-style:italic',
								'hljs-strong' : 'font-weight:700',
							})) {
								tree.match({'attrs': { 'class': key}}, (node) => {
									node.attrs.style = value;
									return node;
								});
							}
						})
						.process(htmlWithClasses, {sync: true})
						.html;
				}
			}, (err, content) => {
				if (err) {
					reject(err);
				} else {
					// Add background to pre tag
					const contentWithPreBackground = posthtml()
						.use((tree) => {
							tree.match({'tag':'pre'}, (node) => {
								Object.assign(node, {
									attrs: {
										style: 'background:#002b36; color:#839496'
									}
								});
								return node;
							});
						})
						.process(content, {sync: true})
						.html;
					resolve([thread, contentWithPreBackground]);
				}
			});
		});
	}).spread((thread, htmlizedMarkdown) => {
		const mostRecentMessage = thread.mostRecentMessageSatisfying(() => true);
		const replyTo = mostRecentMessage.replyTo();
		if (replyTo == null) {
			throw "TODO: How should we handle the case where we can't find a reply to?";
		}
		const threadParticipants = mostRecentMessage.recipients().concat(replyTo);
		if (threadParticipants.some(person => person == null)) {
			logger.warn(`Got null receiver in ${util.inspect(threadParticipants)} from thread ${util.inspect(thread)}`);
		}
		const peopleOtherThanYourself = _.uniqBy(
			threadParticipants
				.filter(person => person != null && person.email !== req.body.myEmail),
			recipient => recipient.email
		);
		const toLine = peopleOtherThanYourself.map(person => util.format("%s <%s>", person.name, person.email));
		const inReplyToId = Optional.ofNullable(mostRecentMessage.header('Message-ID'))
			.map((header) => header.value)
			.orElse(null);
		const mail = mailcomposer({
			from: req.body.myEmail,
			to: toLine,
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
