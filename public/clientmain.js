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
	handlebarsTemplates.deletedMessages = Handlebars.compile($('#handlebar-deleted-messages').html());
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

	Handlebars.registerHelper('pluralize', function(number, singular, plural) {
		return number === 1 ? single : plural;
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

	function deleteThreadFromUI(threadId) {
		var $uiElemToDelete = $main.find('.thread[data-thread-id="'+threadId+'"]');
		$uiElemToDelete.hide(400, function () {
			$uiElemToDelete.remove();
		});
	}

	function deleteThread(threadId) {
		return promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
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
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	var $threadViewer = $('#thread-viewer');


	$main.on('click', 'button.delete', function(eventObject) {
		var btnDelete = eventObject.currentTarget;
		var $divThread = $(btnDelete).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		deleteThread(threadId).done();
		return false;
	});
	$threadViewer.find('button.delete').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			deleteThread(threadId).then(function() {
				$threadViewer.modal('hide');
			}).done();
		} else {
			console.log("Tried to delete from threadViewer, but there's no thread id.");
		}
		return false;
	});
	$main.on('click', 'a.view-on-gmail', function(eventObject) {
		//Prevent bubbling, but otherwise do nothing since it's a link.
		eventObject.stopPropagation()
		return true;
	});
	$threadViewer.find('button.view-on-gmail').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			window.open('https://mail.google.com/mail/u/0/#inbox/' + threadId,'_blank');
		} else {
			console.log("Tried to view-on-gmail from threadViewer, but there's no thread id.");
		}
		return false;
	});
	var $laterPicker = $('#later-picker');
	$main.on('click', 'button.later', function(eventObject) {
		var btnLater = eventObject.currentTarget;
		var $divThread = $(btnLater).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		$laterPicker.find('.modal-title').text($divThread.find('.subject').text());
		$laterPicker.data('threadId', threadId);
		$laterPicker.modal('show');
		return false;
	});
	$threadViewer.find('button.later').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			$threadViewer.modal('hide');
			$laterPicker.find('.modal-title').text('TODO');
			$laterPicker.data('threadId', threadId);
			$laterPicker.modal('show');
		} else {
			console.log("Tried to do `later` from threadViewer, but there's no thread id.");
		}
		return false;
	});
	$laterPicker.on('click', '.button', function(eventObject) {
		var threadId = $laterPicker.data('threadId');
		if (!threadId) {
			console.log('Tried to hide thread from laterPicker, but no threadId found.');
			return;
		}
		var btnClicked = eventObject.currentTarget;
		var todaysEvening = moment().hour(18).startOf('hour');
		var tomorrowsEvening = moment(todaysEvening).add(1, 'day');
		var hideUntil = null;
		switch ($(btnClicked).data('value')) {
			case 'hours':
				hideUntil = moment().add(3, 'hours');
				break;
			case 'evening':
				if (moment().add(3, 'hours').isBefore(todaysEvening)) {
					hideUntil = todaysEvening;
				} else {
					hideUntil = tomorrowsEvening;
				}
				break;
			case 'tomorrow':
				hideUntil = moment().hour(7).startOf('hour').add(1, 'day');
				break;
			case 'weekend':
				hideUntil = moment().day(6).hour(7).startOf('hour');
				if (hideUntil.isBefore(moment())) {
					hideUntil.add(1, 'week');
				}
				break;
			case 'monday':
				hideUntil = moment().day(1).hour(7).startOf('hour');
				if (hideUntil.isBefore(moment())) {
					hideUntil.add(1, 'week');
				}
				break;
			case 'month':
				hideUntil = moment().add(1, 'month').hour(7).startOf('hour');
				break;
			case 'someday':
				hideUntil = moment().add(6, 'month').hour(7).startOf('hour');
				break;
			case 'custom':
				//TODO
			default:
				console.log("Forgot to implement", $(btnClicked).data('value'));
				return;
		}
		console.log("Hiding thread", threadId, "until", hideUntil.fromNow(), hideUntil.format(), hideUntil.valueOf());
		$.ajax({
			url: '/api/threads/' + threadId + '/hideUntil',
			data: { hideUntil: hideUntil.valueOf() },
			method: 'PUT'
		}).done(function() {
			$laterPicker.modal('hide');
			deleteThreadFromUI(threadId);
		}).fail(function() {
			console.log("Failure while setting threads.", arguments);
		});
		return false;
	});
	
	$main.on('click', 'div.thread', function(eventObject) {
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
			var nonDeletedMessages = threadData.filter(function(message) {
				return !message.deleted;
			})
			if (threadData.length > nonDeletedMessages.length) {
				$threads.append(handlebarsTemplates.deletedMessages({
					num: threadData.length - nonDeletedMessages.length,
					threadId: threadId
				}));
			}
			nonDeletedMessages.forEach(function(message) {
				$threads.append(handlebarsTemplates.message(message));
			});
		}).fail(function(jqXHR, textStatus, errorThrown) {
			console.log('Error getting thread data', arguments);
		});
	});
	
});