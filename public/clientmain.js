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
	var $main = $('#main');

	var handlebarsTemplates = {}
	handlebarsTemplates.thread = Handlebars.compile($('#handlebar-thread').html());
	handlebarsTemplates.message = Handlebars.compile($('#handlebar-message').html());
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

	function saveThreads(fnAuthorizationGetter) {
		return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly').then(function(gapi) {
			return Q.Promise(function(resolve, reject) {
				gapi.client.gmail.users.threads.list({
					'userId': 'me',
					'labelIds': ['INBOX']
				}).execute(resolve);
			}).then(function(resp) {
				return resp.threads.map(function(item) {
					return Q.promise(function(resolve, reject) {
						gapi.client.gmail.users.threads.get({
							userId: 'me',
							id: item.id
						}).execute(function(resp) {
							$.post(
								'/api/threads',
								resp.result
							).done(resolve).fail(reject);
						});
					});
				});
			}).then(function(arrOfPromises) {
				return Q.all(arrOfPromises);
			});
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

	function getAuthorizationGetter(gapi, clientId) {
		var alreadyPromisedScopes = {};
		return function(scope) {
			if (!alreadyPromisedScopes[scope]) {
				alreadyPromisedScopes[scope] = Q.Promise(function(resolve, reject) {
					gapi.auth.authorize({client_id: clientId, scope: scope, immediate: true}, function(authResult) {
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
			return alreadyPromisedScopes[scope];
		}
	}

	var promisedFnAuthorizationGetter = Q.all([
		waitForGapiToLoad(), promisedClientId
	]).spread(function(gapi, clientId) {
		return getAuthorizationGetter(gapi, clientId);
	});

	promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
		return saveThreads(fnAuthorizationGetter);
	}).then(function() {
		showThreads();
	}).done();

	$('#main').on('click', 'button.delete', function(eventObject) {
		var btnDelete = eventObject.currentTarget;
		var $divThread = $(btnDelete).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function trashOnGmail(gapi) {
			return Q.Promise(function(resolve, reject) {
				console.log('Calling Gmail API thread.trash', threadId);
				gapi.client.gmail.users.threads.trash({
					userId: 'me',
					id: threadId
				}).execute(function (resp) {
					console.log('Gmail API thread.trash responded with', resp);
					if (resp.id === threadId) {
						resolve(resolve); //Successfully deleted from gmail.
					} else {
						//delete not successful.
						if (resp.code === 403) {
							//TODO: Insufficient permissions.
						}
						reject(resp);
					}
				});
			});
		}).then(function deleteOnLocalCache() {
			return Q.Promise(function(resolve, reject) {
				$.ajax({
					url: '/api/threads/' + threadId,
					type: 'DELETE'
				}).done(resolve).fail(reject);
			});
		}).then(function deleteFromUI() {
			$divThread.remove();
		}).done();
		return false;
	});
	var $threadViewer = $('#thread-viewer');
	$('#main').on('click', 'div.thread', function(eventObject) {
		var $threadDiv = $(eventObject.currentTarget);
		var threadId = $threadDiv.data('threadId');
		var $threads = $threadViewer.find('.threads')
		$threadViewer.data('threadId', threadId);
		$threadViewer.find('.modal-title').text($threadDiv.find('.subject').text());
		$threadViewer.find('.senders').text($threadDiv.find('.senders').attr('title') || '');
		$threadViewer.find('.receivers').text($threadDiv.find('.receivers').attr('title') || '');
		$threads.text($threadDiv.find('.snippet').text());
		$threadViewer.find('.loading-img').show();
		$threadViewer.modal('show');
		$.get('/api/threads/' + threadId +'/messages').done(function(threadData, textStatus, jqXHR) {
			if ($threadViewer.data('threadId') !== threadId) {
				//The user closed the modal and opened a new thread; this ajax result is stale.
				return;
			}
			$threadViewer.find('.loading-img').hide();
			$threads.empty();
			threadData.forEach(function(message) {
				console.log('original', message.body.original, 'sanitized', message.body.sanitized);
				$threads.append(handlebarsTemplates.message(message));
			});
		}).fail(function(jqXHR, textStatus, errorThrown) {
			console.log('Error getting thread data', arguments);
		});
	});
	
});