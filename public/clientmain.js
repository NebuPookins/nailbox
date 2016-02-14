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

	var handlebarsTemplates = {};
	handlebarsTemplates.thread = Handlebars.compile($('#handlebar-thread').html());
	handlebarsTemplates.message = Handlebars.compile($('#handlebar-message').html());
	handlebarsTemplates.deletedMessages = Handlebars.compile($('#handlebar-deleted-messages').html());
	handlebarsTemplates.labelSelection = Handlebars.compile($('#handlebar-label-selection').html());
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
		return number === 1 ? singular : plural;
	});

	Handlebars.registerHelper('labelIdToName', function(labelId) {
		/*
		 * If the promise isn't ready yet, just immediately return an empty string.
		 * We want to show the e-mails right away, even if it means we don't know
		 * the labels yet.
		 */
		var promiseSnapshot = promisedLabels.inspect();
		if (promiseSnapshot.state === 'fulfilled') {
			var labelObj = promiseSnapshot.value.find(function(label) { return label.id === labelId; });
			/*
			 * For whatever reason, the system labels that begin with "CATEGORY_"
			 * (e.g. "CATEGORY_SOCIAL") don't have a pleasant display name.
			 */
			var match = /^CATEGORY_([A-Z]+)$/.exec(labelObj.id);
			if (labelObj.type === 'system' && match !== null) {
				return match[1].charAt(0).toUpperCase() + match[1].substr(1).toLowerCase();
			}
			return promiseSnapshot.value.find(function(label) { return label.id === labelId; }).name;
		} else {
			return '';
		}
	});

	String.prototype.hashCode = function() {
		var hash = 0, i, chr, len;
		if (this.length === 0) return hash;
		for (i = 0, len = this.length; i < len; i++) {
			chr   = this.charCodeAt(i);
			hash  = ((hash << 5) - hash) + chr;
			hash |= 0; // Convert to 32bit integer
		}
		return hash;
	};

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
				}).execute(resolve); //TODO: Handle errors
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
				var filteredThread = thread;
				filteredThread.mainDisplayedLabelIds = thread.labelIds.filter(function(labelId) {
					switch (labelId) {
						/*
						 * Every e-mail we display is in the INBOX.
						 */
						case 'INBOX': return false;
						/*
						 * Controversial design choice: We think inbox zero is facilitated
						 * if we get rid of the distracting concept of a read e-mail vs an
						 * unread e-mail.
						 */
						case 'UNREAD': return false;
						case 'SENT': return false;
						case 'TRASH': return false;
						default: return true;
					}
				});
				var $thread = $(handlebarsTemplates.thread(filteredThread));
				$thread.data('labelIds', thread.labelIds);
				$main.append($thread);
			});
		});
	}

	showThreads();
	setInterval(function() {
		console.log('Refreshing threads.');
		showThreads();
	}, moment.duration(5, 'minutes').as('milliseconds'));

	function getAuthorizationGetter(gapi, clientId) {
		var alreadyPromisedScopes = {};
		return function(scope) {
			if ((!alreadyPromisedScopes[scope]) || alreadyPromisedScopes[scope].expiresAt.isBefore(/*now*/)) {
				var oAuthToken = Q.Promise(function(resolve, reject) {
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
				alreadyPromisedScopes[scope] = {
					oAuthToken: oAuthToken,
					expiresAt: moment().add(oAuthToken.expires_in, 'seconds')
				};
			}
			return alreadyPromisedScopes[scope].oAuthToken;
		};
	}

	var promisedFnAuthorizationGetter = Q.all([
		waitForGapiToLoad(), promisedClientId
	]).spread(function(gapi, clientId) {
		return getAuthorizationGetter(gapi, clientId);
	});

	var promisedMyEmail = promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
		return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly');
	}).then(function(gapi) {
		return Q.Promise(function(resolve, reject) {
			gapi.client.gmail.users.getProfile({userId: 'me'})
				.execute(function(resp) {
					if (resp.emailAddress) {
						resolve(resp.emailAddress);
					} else {
						reject(resp);
					}
				});
		});
	});

	var promisedLabels = promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
		return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.readonly');
	}).then(function(gapi) {
		return Q.Promise(function(resolve, reject) {
			console.log("Loading labels...");
			gapi.client.gmail.users.labels.list({
				userId: 'me'
			}).execute(function(resp) {
				if (_.isArray(resp.labels)) {
					resolve(_.sortBy(resp.labels, function(label) {
						/*
						 * Show all the system labels before the user labels, then sort
						 * within each category by name.
						 */
						return (label.type === 'system' ? 'A' : 'B') + label.name.toLowerCase();
					}));
				} else {
					reject(resp);
				}
			});
		});
	});

	var promiseThreadsUpdatedFromGmail = promisedFnAuthorizationGetter.then(function(fnAuthorizationGetter) {
		return saveThreads(fnAuthorizationGetter);
	});
	Q.all([promisedLabels, promiseThreadsUpdatedFromGmail]).then(function() {
		showThreads();
	}).done();

	function deleteThreadFromUI(threadId) {
		var $uiElemToDelete = $main.find('.thread[data-thread-id="'+threadId+'"]');
		$uiElemToDelete.hide(400, function () {
			$uiElemToDelete.remove();
		});
	}

	function deleteOnLocalCache(threadId) {
			return Q.Promise(function(resolve, reject) {
				$.ajax({
					url: '/api/threads/' + threadId,
					type: 'DELETE'
				}).done(resolve).fail(reject);
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
		}).then(function() {
			return deleteOnLocalCache(threadId);
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	function archiveThread(threadId) {
		return promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function trashOnGmail(gapi) {
			return Q.Promise(function(resolve, reject) {
				console.log('Calling Gmail API threads.modify (archiving)', threadId);
				gapi.client.gmail.users.threads.modify({
					userId: 'me',
					id: threadId,
					removeLabelIds: ['INBOX']
				}).execute(function (resp) {
					console.log('Gmail API thread.modify (archiving) responded with', resp);
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
		}).then(function() {
			return deleteOnLocalCache(threadId);
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	function moveThreadToLabel(threadId, labelId) {
		//TODO: Share code with archiveThread
		return promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function(gapi) {
			return Q.Promise(function(resolve, reject) {
				console.log('Calling Gmail API threads.modify (moving to label)', threadId);
				gapi.client.gmail.users.threads.modify({
					userId: 'me',
					id: threadId,
					removeLabelIds: ['INBOX','UNREAD'],
					addLabelIds: [labelId]
				}).execute(function (resp) {
					console.log('Gmail API thread.modify (moving to label) responded with', resp);
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
		}).then(function() {
			return deleteOnLocalCache(threadId);
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
	$threadViewer.find('button.reply-all').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (!threadId) {
			console.log("Tried to reply to thread from threadViewer, but there was no threadId.");
			return;
		}
		var promisedEncodedEmail = promisedMyEmail.then(function(myEmail) {
			return Q.Promise(function(resolve, reject) {
				console.log('POST-ing to get RFC2822 content...');
				$.post('/api/rfc2822', {
					myEmail: myEmail,
					threadId: threadId,
					body: $threadViewer.find('.reply textarea').val(),
					inReplyTo: $threadViewer.find('.threads .message:last').data('messageId')
				}).done(resolve).fail(reject);
			});
		});
		promisedFnAuthorizationGetter.then(function requestDeletePermission(fnAuthorizationGetter) {
			return fnAuthorizationGetter('https://www.googleapis.com/auth/gmail.modify');
		}).then(function(gapi) {
			return promisedEncodedEmail.then(function(base64EncodedEmail) {
				return Q.Promise(function(resolve, reject) {
					gapi.client.gmail.users.messages.send({
						userId: 'me',
						uploadType: 'media',
						threadId: threadId,
						raw: base64EncodedEmail
					}).execute(function(resp) {
						if (resp.id) {
							console.log("Successfully sent message with id", resp.id);
							resolve(resp);
						} else {
							console.log("Failed to send message:", resp);
							reject(resp);
						}
					});
				});
			});
		}).then(function() {
			$threadViewer.find('.reply textarea').val('');
			$threadViewer.modal('hide');
		}).done();
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
		eventObject.stopPropagation();
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
	$main.on('click', 'button.archive-thread', function(eventObject) {
		var btnDelete = eventObject.currentTarget;
		var $divThread = $(btnDelete).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		archiveThread(threadId).done();
		return false;
	});
	$threadViewer.find('button.archive-thread').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			archiveThread(threadId).then(function() {
				$threadViewer.modal('hide');
			}).done();
		} else {
			console.log("Tried to archive from threadViewer, but there's no thread id.");
		}
		return false;
	});
	var $labelPicker = $('#label-picker');
	var $laterPicker = $('#later-picker');
	function mainClickerShowPicker($mainBtnClicked, $picker) {
		var $divThread = $mainBtnClicked.parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		$picker.find('.modal-title').text($divThread.find('.subject').text());
		$picker.data('threadId', threadId);
		$picker.modal('show');
		return false;
	}
	function switchFromThreadViewerToPicker($picker) {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			$threadViewer.modal('hide');
			$picker.find('.modal-title').text($threadViewer.find('.modal-title').text());
			$picker.data('threadId', threadId);
			$picker.modal('show');
		} else {
			console.log("Tried to switch from threadViewer to ", $picker, ", but there's no thread id.");
		}
		return false;
	}
	var promisedThatLabelsOnLabelPickerArePopulated = promisedLabels.then(function(labels) {
		var $labelList = $labelPicker.find('ul.label-list');
		$labelList.empty();
		labels
			.filter(function(label) {
				return label.labelListVisibility !== 'labelHide';
			}).filter(function(label) {
				/*
				 * According to https://developers.google.com/gmail/api/guides/labels
				 * SENT and DRAFT cannot be manually applied.
				 */
				return label.id !== 'SENT' && label.id !== 'DRAFT';
			}).filter(function(label) {
				/*
				 * This command is more about moving to a folder than labelling.
				 * Remove the labels where it doesn't make sense to "move" into.
				 */
				return label.id !== 'INBOX' &&
					label.id !== 'IMPORTANT' &&
					label.id !== 'STARRED' &&
					label.id !== 'TRASH' &&
					label.id !== 'UNREAD';
			}).forEach(function(label) {
				$labelList.append(handlebarsTemplates.labelSelection({
					id: label.id,
					isSystem: label.type === 'system',
					hue: (label.name.hashCode() % 360)
				}));
			});
	});
	$main.on('click', 'button.label-thread', function(eventObject) {
		promisedThatLabelsOnLabelPickerArePopulated.then(function() {
			mainClickerShowPicker($(eventObject.currentTarget), $labelPicker);
		}).done();
		return false;
	});
	$threadViewer.find('button.label-thread').on('click', function() {
		promisedThatLabelsOnLabelPickerArePopulated.then(function() {
		}).then(function() {
			return switchFromThreadViewerToPicker($labelPicker);
		}).done();
		return false;
	});
	
	$main.on('click', 'button.later', function(eventObject) {
		return mainClickerShowPicker($(eventObject.currentTarget), $laterPicker);
	});
	$threadViewer.find('button.later').on('click', function() {
		return switchFromThreadViewerToPicker($laterPicker);
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
		var hideUntil;
		switch ($(btnClicked).data('value')) {
			case 'hours':
				hideUntil = {
					type: 'timestamp',
					value: moment().add(3, 'hours').valueOf()
				};
				break;
			case 'evening':
				if (moment().add(3, 'hours').isBefore(todaysEvening)) {
					hideUntil = {
						type: 'timestamp',
						value: todaysEvening.valueOf()
					};
				} else {
					hideUntil = {
						type: 'timestamp',
						value: tomorrowsEvening.valueOf()
					};
				}
				break;
			case 'tomorrow':
				hideUntil = {
					type: 'timestamp',
					value: moment().hour(7).startOf('hour').add(1, 'day').valueOf()
				};
				break;
			case 'weekend':
				var weekend = moment().day(6).hour(7).startOf('hour');
				if (weekend.isBefore(moment())) {
					weekend.add(1, 'week');
				}
				hideUntil = {
					type: 'timestamp',
					value: weekend.valueOf()
				};
				break;
			case 'monday':
				var monday = moment().day(1).hour(7).startOf('hour');
				if (monday.isBefore(moment())) {
					monday.add(1, 'week');
				}
				hideUntil = {
					type: 'timestamp',
					value: monday.valueOf()
				};
				break;
			case 'month':
				hideUntil = {
					type: 'timestamp',
					value: moment().add(1, 'month').hour(7).startOf('hour').valueOf()
				};
				break;
			case 'someday':
				hideUntil = {
					type: 'timestamp',
					value: moment().add(6, 'month').hour(7).startOf('hour').valueOf()
				};
				break;
			case 'when-i-have-time':
				hideUntil = {
					type: 'when-i-have-time'
				};
				break;
			//case 'custom': //TODO
			default:
				console.log("Forgot to implement", $(btnClicked).data('value'));
				return;
		}
		console.log("Hiding thread", threadId, "until", hideUntil);
		$.ajax({
			url: '/api/threads/' + threadId + '/hideUntil',
			data: hideUntil,
			method: 'PUT'
		}).done(function() {
			$laterPicker.modal('hide');
			deleteThreadFromUI(threadId);
		}).fail(function() {
			console.log("Failure while setting threads.", arguments);
		});
		return false;
	});
	$labelPicker.on('click', 'button', function(eventObject) {
		var threadId = $labelPicker.data('threadId');
		if (!threadId) {
			console.log('Tried to hide thread from laterPicker, but no threadId found.');
			return;
		}
		var labelId = $(eventObject.currentTarget).data('label-id');
		moveThreadToLabel(threadId, labelId).then(function() {
			$labelPicker.modal('hide');
		}).done();
	});
	
	$main.on('click', 'div.thread', function(eventObject) {
		var $threadDiv = $(eventObject.currentTarget);
		var threadId = $threadDiv.data('threadId');
		var $threads = $threadViewer.find('.threads');
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
			var nonDeletedMessages = threadData.messages.filter(function(message) {
				return !message.deleted;
			});
			if (threadData.messages.length > nonDeletedMessages.length) {
				$threads.append(handlebarsTemplates.deletedMessages({
					num: threadData.messages.length - nonDeletedMessages.length,
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