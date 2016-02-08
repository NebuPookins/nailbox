$(function() {
	'use strict';

	if (!console) {
		console = {};
	}
	if (!console.log) {
		console.log = function() {};
	}
	
	var promisedClientId = Q.Promise(function(resolve, reject) {
		$.get({
			url: '/api/clientId'
		}).done(function(clientId, textStatus, jqXHR) {
			resolve(clientId);
		}).fail(function(jqXHR, textStatus, errorThrown) {
			reject(textStatus);
		});
	});
	var SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
	var $main = $('#main');

	var handlebarsTemplates = {}
	handlebarsTemplates.thread = Handlebars.compile($('#handlebar-thread').html());
	Handlebars.registerHelper('nMore', function(total, amountToSubtract) {
		if (typeof amountToSubtract !== 'number') {
			amountToSubtract = 1;
		}
		return total - amountToSubtract;
	});

	Handlebars.registerHelper("prettyTimestamp", function(timestamp) {
		var now = moment();
		var momentToFormat = moment(timestamp);
		if (momentToFormat.isSame(now, 'day')) {
			return momentToFormat.format('h:mm A');
		} else if (momentToFormat.isSame(now, 'week')) {
			return momentToFormat.format('ddd h:mm A');
		} else if (momentToFormat.isSame(now, 'year')) {
			return momentToFormat.format('MMM Do');
		} else {
			return momentToFormat.format('YYYY-MMM-DD');
		}
	});

	/**
	 * Waits for the global variable `gapi`, representing the Google API, to
	 * finish loading.
	 */
	function waitForGapiToLoad() {
		return Q.Promise(function(resolve, reject) {
			function _waitForGapiToLoad() {
				if (gapi && gapi.auth && gapi.auth.authorize) {
					resolve(gapi);
				} else {
					setTimeout(_waitForGapiToLoad, 500);
				}
			}
			_waitForGapiToLoad();
		});
	}

	function attemptToAuthorize(gapi, clientId) {
		return Q.Promise(function(resolve, reject) {
			gapi.auth.authorize({client_id: clientId, scope: SCOPES, immediate: false}, function(authResult) {
				if (authResult.error) {
					reject(authResult);
				} else {
					gapi.client.load('gmail', 'v1', function() {
						resolve(gapi);
					});
				}
			});
		});
	}

	function saveThreads(gapi) {
		return Q.Promise(function(resolve, reject) {
			gapi.client.gmail.users.threads.list({
				'userId': 'me',
				'labelIds': ['INBOX']
			}).execute(function(resp) {
				resolve(resp);
			});
		}).then(function(resp) {
			return resp.threads.map(function(item) {
				return Q.promise(function(resolve, reject) {
					gapi.client.gmail.users.threads.get({
						userId: 'me',
						id: item.id
					}).execute(function(resp) {
						$.post('/api/threads', resp.result).done(function() {
							resolve();
						})
					});
				});
			});
		}).then(function(arrOfPromises) {
			return Q.all(arrOfPromises);
		});
	}

	function showThreads() {
		$.get({
			url: '/api/threads',
			dataType: 'json'
		}).done(function(threads, textStatus, jqXHR) {
			$('#status').hide();
			$main.text('');
			threads.forEach(function(thread) {
				$main.append(handlebarsTemplates.thread(thread));
			})
		})
	}
	showThreads();

	Q.all([
		waitForGapiToLoad(), promisedClientId
	]).spread(function(gapi, clientId) {
		return attemptToAuthorize(gapi, clientId);
	}).then(function(gapi) {
		return saveThreads(gapi);
	}).then(function() {
		showThreads();
	}).done();
});