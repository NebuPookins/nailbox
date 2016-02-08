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

function saveConfig(config) {
	return q.Promise(function(resolve, reject) {
		nodeFs.writeFile(PATH_TO_CONFIG, JSON.stringify(config), function(err) {
			if (err) {
				reject(err);
			} else {
				resolve(config);
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
(function() {
	logger.debug("Testing parseEmailToString...");
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
	return message.payload.headers.filter(function(header) {
		return header.name === headerName;
	});
}

function mostRecentMessageSatisfying(threadData, fnMessagePredicate) {
	const satisfyingMessages = threadData.messages.filter(fnMessagePredicate);
	return _.maxBy(satisfyingMessages, function(message) {
		return parseInt(message.internalDate);
	});
}

function mostRecentSubjectInThread(threadData) {
	const newestMessageWithSubject = mostRecentMessageSatisfying(threadData, function(message) {
		return ! _.isEmpty(headersInMessage('Subject', message));
	});
	return headersInMessage('Subject', newestMessageWithSubject)[0].value;
}

function mostRecentSnippetInThread(threadData) {
	const newestMessageWithSnippet = mostRecentMessageSatisfying(threadData, function(message) {
		return message.snippet;
	});
	return newestMessageWithSnippet.snippet;
}

function peopleInThread(threadData, fnFilter) {
	const recipients = threadData.messages.map(function(message) {
		return message.payload.headers
			.filter(fnFilter)
			.map(function(header) {
				var retVal = parseEmailToString(header.value);
				return retVal;
			}).reduce(function(a, b) {
				return a.concat(b); //Flatten the array of arrays.
			});
	}).reduce(function(a, b) {
			return a.concat(b); //Flatten the array of arrays.
	});
	return _.uniqBy(recipients, function(recipient) {
		return recipient.email;
	});
}

logger.info("Checking directory structure...");
ensureDirectoryExists('data/threads').then(function() {
	return logger.info("Directory structure looks fine.");
}).then(function() {
	return q.Promise(function(resolve, reject) {
		nodeFs.readFile(PATH_TO_CONFIG, function(err, strFileContents) {
			if (err) {
				if (err.code === 'ENOENT') {
					logger.info(util.format("No config file found at %s, using default settings.", PATH_TO_CONFIG));
					resolve({});
				} else {
					reject(err);
				}
			} else {
				resolve(JSON.parse(strFileContents));
			}
		});
	});
}).then(function(config) {
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
		saveConfig(config).then(function() {
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
					return q.Promise(function(resolve, reject) {
						nodeFs.readFile('data/threads/' + filename, function(err, strFileContents) {
							if (err) {
								reject(err);
							} else {
								const threadData = JSON.parse(strFileContents);
								const relevantData = {
									threadId: threadData.id,
									senders: sendersInThread(threadData),
									receivers: recipientsInThread(threadData),
									lastUpdated: threadLastUpdated(threadData),
									subject: mostRecentSubjectInThread(threadData),
									snippet: mostRecentSnippetInThread(threadData)
								};
								resolve(relevantData);
							}
						});
					});
				})).then(function (files) {
					res.status(200);
					res.type('json');
					res.send(_.sortBy(files, function(thread) {
						return -thread.lastUpdated;
					}));
				}).done();
			}
		});
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