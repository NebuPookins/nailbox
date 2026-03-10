$(function() {
	'use strict';

	if (!console) {
		console = {};
	}
	if (!console.log) {
		console.log = function() {};
	}

	if (typeof Messenger !== 'undefined') {
		Messenger({
			messageDefaults: {
				showCloseButton: true,
				closeButtonText: 'x'
			}
		});
	}

	var messengerGetter = (function() {
		var mockMessenger = {
			info: function() { return mockMessenger; },
			update: function() { return mockMessenger; },
			error: function() { return mockMessenger; }
		};
		return function() {
			if (typeof Messenger === 'undefined') {
				return mockMessenger;
			}
			return Messenger();
		};
	})();

	var $main = $('#main');
	var $status = $('#status');
	var $authControls = $('#auth-controls');
	var $threadViewer = $('#thread-viewer');
	var $labelPicker = $('#label-picker');
	var $laterPicker = $('#later-picker');
	var $settingsBtn = $('#settings-btn');
	var $settingsModal = $('#settings-modal');
	var $groupingRulesRoot = $('#grouping-rules-root');

	var authStatus = {
		configured: false,
		connected: false,
		emailAddress: null,
		scopes: []
	};
	var labelsCache = [];
	var groupingRulesIsland = null;

	var handlebarsTemplates = {};
	handlebarsTemplates.group = Handlebars.compile($('#handlebar-group').html());
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

	Handlebars.registerHelper('filesize', function(bytes) {
		if (typeof filesize === 'function') {
			return filesize(bytes);
		}
		/*
		 * The filesize function is supposed to be loaded via CDN, but that has
		 * failed before when the remote asset was unavailable. Keep a trivial
		 * fallback here so attachment rendering still works.
		 */
		return bytes + ' bytes';
	});

	Handlebars.registerHelper('prettyTimestamp', function(timestamp) {
		var now = moment();
		var momentToFormat = moment(timestamp);
		if (momentToFormat.isSame(now, 'day')) {
			return momentToFormat.format('h:mm A');
		}
		if (momentToFormat.isSame(now, 'week')) {
			return momentToFormat.format('ddd h:mm A');
		}
		if (momentToFormat.isSame(now, 'year')) {
			return momentToFormat.format('MMM Do');
		}
		return momentToFormat.format('YYYY-MMM-DD');
	});

	Handlebars.registerHelper('formatReadTime', function(totalSeconds) {
		if (typeof totalSeconds !== 'number' || totalSeconds < 0) {
			return '';
		}
		if (totalSeconds === 0) {
			return '0 sec read';
		}
		if (totalSeconds < 60) {
			return totalSeconds + ' sec read';
		}
		var minutes = Math.round(totalSeconds / 60);
		if (minutes <= 1) {
			return '1 min read';
		}
		return minutes + ' min read';
	});

	Handlebars.registerHelper('pluralize', function(number, singular, plural) {
		return number === 1 ? singular : plural;
	});

	Handlebars.registerHelper('labelIdToName', function(labelId) {
		var labelObj = labelsCache.find(function(label) { return label.id === labelId; });
		if (!labelObj) {
			return '';
		}
		var match = /^CATEGORY_([A-Z]+)$/.exec(labelObj.id);
		if (labelObj.type === 'system' && match !== null) {
			return match[1].charAt(0).toUpperCase() + match[1].substr(1).toLowerCase();
		}
		return labelObj.name;
	});

	String.prototype.hashCode = function() {
		var hash = 0;
		var i;
		var chr;
		if (this.length === 0) {
			return hash;
		}
		for (i = 0; i < this.length; i++) {
			chr = this.charCodeAt(i);
			hash = ((hash << 5) - hash) + chr;
			hash |= 0; // Convert to 32bit integer
		}
		return hash;
	};

	function apiRequest(options) {
		return Q.Promise(function(resolve, reject) {
			$.ajax(options).done(function(data) {
				resolve(data);
			}).fail(function(jqXHR, textStatus, errorThrown) {
				handleApiFailure(jqXHR, textStatus || errorThrown);
				reject(jqXHR);
			});
		});
	}

	function handleApiFailure(jqXHR, fallbackMessage) {
		var responseJson = jqXHR && jqXHR.responseJSON;
		if (responseJson && responseJson.code === 'GOOGLE_REAUTH_REQUIRED') {
			authStatus.connected = false;
			authStatus.emailAddress = null;
			renderDisconnectedState('Google authorization expired. Reconnect Gmail to continue.');
			return;
		}
		if (responseJson && responseJson.code === 'GOOGLE_AUTH_MISCONFIGURED') {
			renderSetupNeededState('Google OAuth is not configured.');
			return;
		}
		if (fallbackMessage) {
			messengerGetter().error(fallbackMessage);
		}
	}

	function renderSetupNeededState(message) {
		$status.show().html(
			'<h1>Google OAuth setup required</h1>' +
			'<p>' + _.escape(message || 'Configure Google OAuth before Nailbox can talk to Gmail.') + '</p>' +
			'<p><a class="btn btn-primary" href="/setup">Open setup</a></p>'
		);
		$main.empty();
		$authControls.empty();
	}

	function renderDisconnectedState(message) {
		$status.show().html(
			'<h1>Connect Gmail</h1>' +
			'<p>' + _.escape(message || 'Gmail is not connected.') + '</p>' +
			'<p><a class="btn btn-primary" href="/auth/google/start">Connect Gmail</a> ' +
			'<a class="btn btn-default" href="/setup">Review setup</a></p>'
		);
		$main.empty();
		$authControls.html('<a class="btn btn-primary btn-sm" href="/auth/google/start">Connect Gmail</a>');
	}

	function renderConnectedState() {
		$status.show().html(
			'<h1>Loading Nailbox</h1>' +
			'<p>Reading cached mail and refreshing Gmail in the background...</p>'
		);
		var escapedEmail = _.escape(authStatus.emailAddress || 'Connected');
		$authControls.html(
			'<span class="text-muted" style="margin-right:10px;">' + escapedEmail + '</span>' +
			'<button class="btn btn-default btn-sm" id="refresh-now-btn">Sync Gmail</button> ' +
			'<button class="btn btn-warning btn-sm" id="disconnect-gmail-btn">Disconnect</button>'
		);
	}

	function loadAuthStatus() {
		return apiRequest({
			url: '/api/auth/status',
			method: 'GET',
			dataType: 'json'
		}).then(function(status) {
			authStatus = status;
			return status;
		});
	}

	function loadLabels() {
		return apiRequest({
			url: '/api/gmail/labels',
			method: 'GET',
			dataType: 'json'
		}).then(function(labels) {
			labelsCache = labels;
			populateLabelPicker();
			return labels;
		});
	}

	function populateLabelPicker() {
		var $labelList = $labelPicker.find('ul.label-list');
		$labelList.empty();
		labelsCache
			.filter(function(label) {
				return label.labelListVisibility !== 'labelHide';
			})
			.filter(function(label) {
				return label.id !== 'SENT' && label.id !== 'DRAFT';
			})
			.filter(function(label) {
				return label.id !== 'INBOX' &&
					label.id !== 'IMPORTANT' &&
					label.id !== 'STARRED' &&
					label.id !== 'TRASH' &&
					label.id !== 'UNREAD';
			})
			.forEach(function(label) {
				$labelList.append(handlebarsTemplates.labelSelection({
					id: label.id,
					isSystem: label.type === 'system',
					hue: (label.name.hashCode() % 360)
				}));
			});
	}

	function syncThreadsFromGoogle(updateMessenger) {
		updateMessenger = updateMessenger || messengerGetter().info('Syncing Gmail...');
		updateMessenger.update({
			type: 'info',
			message: 'Syncing Gmail to local cache...'
		});
		return apiRequest({
			url: '/api/gmail/sync',
			method: 'POST',
			dataType: 'json'
		}).then(function(resp) {
			updateMessenger.update({
				type: 'success',
				message: 'Synced ' + resp.syncedThreadCount + ' Gmail threads.'
			});
			return resp;
		});
	}

	function refreshThreadFromGoogle(threadId) {
		return apiRequest({
			url: '/api/gmail/threads/' + threadId + '/refresh',
			method: 'POST'
		}).then(null, function() {
			console.log('Failed to refresh thread', threadId);
		});
	}

	function updateUiWithThreadsFromServer(updateMessenger) {
		updateMessenger = updateMessenger || messengerGetter().info('Refreshing threads from cache...');
		updateMessenger.update({
			type: 'info',
			message: 'Downloading threads from local cache...'
		});
		return apiRequest({
			url: '/api/threads/grouped',
			method: 'GET',
			dataType: 'json'
		}).then(function(groupsOfThreads) {
			$main.empty();
			$status.hide();
			groupsOfThreads.forEach(function(group) {
				$main.append($(handlebarsTemplates.group(group)));
				group.threads.forEach(function(thread) {
					if (thread.needsRefreshing) {
						refreshThreadFromGoogle(thread.threadId);
					}
				});
				group.threads.forEach(function(thread) {
					thread.mainDisplayedLabelIds = thread.labelIds.filter(function(labelId) {
						return labelId !== 'INBOX' && // Every e-mail we display is in the INBOX.
							labelId !== 'UNREAD' && // Controversial design choice: We think inbox zero is faciliated if we get rid of the distracting concept of a read e-mail vs an unread e-mail.
							labelId !== 'SENT' &&
							labelId !== 'TRASH';
					});
					var $thread = $(handlebarsTemplates.thread(thread));
					$thread.data('labelIds', thread.labelIds);
					$main.append($thread);
				});
			});
			if (groupsOfThreads.length === 0) {
				$status.show().html(
					'<h1>No mail in cache yet</h1>' +
					'<p>Use "Sync Gmail" to download mail into the local cache.</p>'
				);
			}
			updateMessenger.update({
				type: 'success',
				message: 'GUI updated with cached threads.'
			});
		}).then(null, function(err) {
			$status.show().html(
				'<h1>Failed to load cached mail</h1>' +
				'<p>Check the server logs, then try syncing Gmail again.</p>'
			);
			throw err;
		});
	}

	function deleteThreadFromUI(threadId) {
		var $uiElemToDelete = $main.find('.thread[data-thread-id="' + threadId + '"]');
		$uiElemToDelete.hide(400, function() {
			$uiElemToDelete.remove();
		});
	}

	function deleteThread(threadId, updateMessenger) {
		updateMessenger.update({
			type: 'info',
			message: 'Deleting thread ' + threadId + '...'
		});
		return apiRequest({
			url: '/api/threads/' + threadId + '/trash',
			method: 'POST',
			dataType: 'json'
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	function archiveThread(threadId, updateMessenger) {
		updateMessenger.update({
			type: 'info',
			message: 'Archiving thread ' + threadId + '...'
		});
		return apiRequest({
			url: '/api/threads/' + threadId + '/archive',
			method: 'POST',
			dataType: 'json'
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	function moveThreadToLabel(threadId, labelId, updateMessenger) {
		updateMessenger.update({
			type: 'info',
			message: 'Moving thread ' + threadId + ' to label...'
		});
		return apiRequest({
			url: '/api/threads/' + threadId + '/move',
			method: 'POST',
			dataType: 'json',
			data: {
				labelId: labelId
			}
		}).then(function() {
			deleteThreadFromUI(threadId);
		});
	}

	function getThreadData(threadId, attemptNumber, updateMessenger) {
		return Q.Promise(function(resolve, reject) {
			$.get('/api/threads/' + threadId + '/messages').done(function(threadData) {
				resolve(threadData);
			}).fail(function() {
				if (attemptNumber < 60) {
					updateMessenger.update({
						type: 'info',
						message: 'Failed to get thread data, retrying...'
					});
					resolve(getThreadData(threadId, attemptNumber + 1, updateMessenger));
				} else {
					updateMessenger.update({
						type: 'error',
						message: 'Failed to get thread data after too many retries.'
					});
					reject('Failed after too many retries');
				}
			});
		});
	}

	function b64toBlob(b64Data) {
		var sliceSize = 512;
		var byteCharacters = atob(b64Data);
		var byteArrays = [];
		for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
			var slice = byteCharacters.slice(offset, offset + sliceSize);
			var byteNumbers = new Array(slice.length);
			for (var i = 0; i < slice.length; i++) {
				byteNumbers[i] = slice.charCodeAt(i);
			}
			byteArrays.push(new Uint8Array(byteNumbers));
		}
		return new Blob(byteArrays);
	}

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
			messengerGetter().error('Missing thread id.');
		}
		return false;
	}

	function createGroupingRulesNotify() {
		return {
			error: function(message) {
				messengerGetter().error(message);
			},
			success: function(message) {
				messengerGetter().info(message).update({
					type: 'success',
					message: message
				});
			}
		};
	}

	function ensureGroupingRulesIsland() {
		var mountGroupingRules;
		if (groupingRulesIsland) {
			return {
				instance: groupingRulesIsland,
				wasCreated: false
			};
		}
		if (!$groupingRulesRoot.length || !window.NailboxGroupingRules) {
			return null;
		}
		mountGroupingRules = window.NailboxGroupingRules.mount || window.NailboxGroupingRules.mountGroupingRulesIsland;
		if (typeof mountGroupingRules !== 'function') {
			return null;
		}
		groupingRulesIsland = mountGroupingRules({
			container: $groupingRulesRoot.get(0),
			api: {
				loadRules: function() {
					return $.ajax({
						url: '/api/email-grouping-rules',
						method: 'GET',
						dataType: 'json'
					});
				},
				saveRules: function(payload) {
					return $.ajax({
						url: '/api/email-grouping-rules',
						method: 'POST',
						contentType: 'application/json',
						data: JSON.stringify(payload)
					});
				}
			},
			notify: createGroupingRulesNotify(),
			onSaved: function() {
				$settingsModal.modal('hide');
				updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...')).done();
			}
		});
		return {
			instance: groupingRulesIsland,
			wasCreated: true
		};
	}

	function bootstrapConnectedApp() {
		renderConnectedState();
		updateUiWithThreadsFromServer(messengerGetter().info('Loading cached threads...'))
			.then(function() {
				return loadLabels().then(null, function() {
					messengerGetter().error('Failed to load Gmail labels. Continuing with cached mail.');
					return [];
				});
			})
			.then(function() {
				return syncThreadsFromGoogle(messengerGetter().info('Downloading new threads from Gmail...'));
			})
			.then(function() {
				return updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
			})
			.then(null, function() {
				messengerGetter().error('Failed to refresh Gmail. Cached mail is still available.');
			})
			.done();

		setInterval(function() {
			if (authStatus.connected) {
				updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...')).done();
			}
		}, moment.duration(5, 'minutes').as('milliseconds'));

		setInterval(function() {
			if (authStatus.connected) {
				syncThreadsFromGoogle(messengerGetter().info('Downloading new threads from Gmail...'))
					.then(function() {
						return updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
					}).done();
			}
		}, moment.duration(30, 'minutes').as('milliseconds'));
	}

	loadAuthStatus().then(function(status) {
		if (!status.configured) {
			renderSetupNeededState();
			return;
		}
		if (!status.connected) {
			renderDisconnectedState();
			return;
		}
		bootstrapConnectedApp();
	}).done();

	$authControls.on('click', '#disconnect-gmail-btn', function() {
		apiRequest({
			url: '/auth/google/disconnect',
			method: 'POST'
		}).then(function() {
			authStatus.connected = false;
			authStatus.emailAddress = null;
			renderDisconnectedState('Gmail disconnected.');
		}).done();
	});

	$authControls.on('click', '#refresh-now-btn', function() {
		syncThreadsFromGoogle(messengerGetter().info('Syncing Gmail...'))
			.then(function() {
				return updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
			}).done();
	});

	$main.on('click', 'button.delete', function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		var updateMessenger = messengerGetter().info('Deleting thread ' + threadId + '...');
		deleteThread(threadId, updateMessenger).then(function() {
			updateMessenger.update({
				type: 'success',
				message: 'Successfully deleted message ' + threadId
			});
		}).done();
		return false;
	});

	$main.on('click', 'button.archive-thread', function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		var updateMessenger = messengerGetter().info('Archiving thread ' + threadId + '...');
		archiveThread(threadId, updateMessenger).then(function() {
			updateMessenger.update({
				type: 'success',
				message: 'Successfully archived thread ' + threadId + '.'
			});
		}).done();
		return false;
	});

	$main.on('click', 'button.label-thread', function(eventObject) {
		mainClickerShowPicker($(eventObject.currentTarget), $labelPicker);
		return false;
	});

	$main.on('click', 'button.later', function(eventObject) {
		return mainClickerShowPicker($(eventObject.currentTarget), $laterPicker);
	});

	$main.on('click', 'div.thread', function(eventObject) {
		var $threadDiv = $(eventObject.currentTarget);
		var threadId = $threadDiv.data('threadId');
		var $threads = $threadViewer.find('.threads');
		var updateMessenger = messengerGetter().info('Downloading thread data for ' + threadId + '...');
		$threadViewer.data('threadId', threadId);
		$threadViewer.find('.modal-title').text($threadDiv.find('.subject').text());
		$threadViewer.find('.senders').text($threadDiv.find('.senders').attr('title') || '');
		$threadViewer.find('.receivers').text($threadDiv.find('.receivers').attr('title') || '');
		$threads.text($threadDiv.find('.snippet').text());
		$threadViewer.find('.loading-img').show();
		$threadViewer.modal('show');
		getThreadData(threadId, 0, updateMessenger).then(function(threadData) {
			if ($threadViewer.data('threadId') !== threadId) {
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
				message.duration = moment.duration(message.timeToReadSeconds, 'seconds').humanize();
				$threads.append(handlebarsTemplates.message(message));
				$.post('/api/threads/' + threadId + '/messages/' + message.messageId + '/wordcount', {
					wordcount: message.wordcount
				});
			});
			updateMessenger.update({
				type: 'success',
				message: 'Successfully downloaded thread data for ' + threadId + '.'
			});
		}).done();
	});

	$threadViewer.find('button.reply-all').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		var updateMessenger = messengerGetter().info('Sending reply to thread ' + threadId + '...');
		if (!threadId || !authStatus.emailAddress) {
			updateMessenger.update({
				type: 'error',
				message: 'Missing thread id or authenticated email address.'
			});
			return;
		}
		apiRequest({
			url: '/api/rfc2822',
			method: 'POST',
			data: {
				myEmail: authStatus.emailAddress,
				threadId: threadId,
				body: $threadViewer.find('.reply textarea').val(),
				inReplyTo: $threadViewer.find('.threads .message:last').data('messageId')
			}
		}).then(function(base64EncodedEmail) {
			return apiRequest({
				url: '/api/gmail/messages/send',
				method: 'POST',
				dataType: 'json',
				data: {
					threadId: threadId,
					raw: base64EncodedEmail
				}
			});
		}).then(function(resp) {
			updateMessenger.update({
				type: 'success',
				message: 'Successfully sent message with id ' + resp.id + '.'
			});
			$threadViewer.find('.reply textarea').val('');
			$threadViewer.modal('hide');
		}).done();
	});

	$threadViewer.on('click', 'button.dl-attachment', function(eventObj) {
		var $clickedButton = $(eventObj.currentTarget);
		var attachmentId = $clickedButton.data('attachment-id');
		var attachmentName = $clickedButton.data('attachment-name');
		var messageId = $clickedButton.parents('.message').data('message-id');
		apiRequest({
			url: '/api/gmail/messages/' + messageId + '/attachments/' + attachmentId,
			method: 'GET',
			dataType: 'json'
		}).then(function(resp) {
			var base64Version = resp.data.replace(/[-_]/g, function(char) {
				return char === '-' ? '+' : '/';
			});
			saveAs(b64toBlob(base64Version), attachmentName);
		}).done();
	});

	$threadViewer.find('button.delete').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		var updateMessenger = messengerGetter().info('Deleting thread ' + threadId + '...');
		if (!threadId) {
			updateMessenger.update({
				type: 'error',
				message: 'Missing thread id.'
			});
			return false;
		}
		deleteThread(threadId, updateMessenger).then(function() {
			updateMessenger.update({
				type: 'success',
				message: 'Successfully deleted message ' + threadId
			});
			$threadViewer.modal('hide');
		}).done();
		return false;
	});

	$threadViewer.find('button.archive-thread').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		var updateMessenger = messengerGetter().info('Archiving thread ' + threadId + '...');
		if (!threadId) {
			updateMessenger.update({
				type: 'error',
				message: 'Missing thread id.'
			});
			return false;
		}
		archiveThread(threadId, updateMessenger).then(function() {
			$threadViewer.modal('hide');
			updateMessenger.update({
				type: 'success',
				message: 'Successfully archived thread ' + threadId + '.'
			});
		}).done();
		return false;
	});

	$threadViewer.find('button.label-thread').on('click', function() {
		return switchFromThreadViewerToPicker($labelPicker);
	});

	$threadViewer.find('button.later').on('click', function() {
		return switchFromThreadViewerToPicker($laterPicker);
	});

	$threadViewer.find('button.view-on-gmail').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			window.open('https://mail.google.com/mail/u/0/#inbox/' + threadId, '_blank');
		}
		return false;
	});

	$threadViewer.on('keydown', function(event) {
		/*
		 * If the textarea (where the user types their reply) has focus, then don't
		 * process any key events.
		 */
		if ($threadViewer.find('textarea').is(':focus')) {
			return;
		}
		if (event.key === 'Delete') {
			var threadId = $threadViewer.data('threadId');
			var updateMessenger = messengerGetter().info('Deleting thread ' + threadId + '...');
			deleteThread(threadId, updateMessenger).then(function() {
				updateMessenger.update({
					type: 'success',
					message: 'Successfully deleted message ' + threadId
				});
				$threadViewer.modal('hide');
			}).done();
		}
	});

	$main.on('click', 'a.view-on-gmail', function(eventObject) {
		// Prevent bubbling, but otherwise do nothing, since it's a link.
		eventObject.stopPropagation();
		return true;
	});

	$laterPicker.on('click', '.button', function(eventObject) {
		var threadId = $laterPicker.data('threadId');
		var updateMessenger = messengerGetter().info('Hiding thread ' + threadId + '.');
		var btnClicked = eventObject.currentTarget;
		var todaysEvening = moment().hour(18).startOf('hour');
		var tomorrowsEvening = moment(todaysEvening).add(1, 'day');
		var hideUntil;
		if (!threadId) {
			updateMessenger.update({
				type: 'error',
				message: 'Tried to hide thread, but no threadId was found.'
			});
			return;
		}
		switch ($(btnClicked).data('value')) {
			case 'hours':
				hideUntil = {
					type: 'timestamp',
					value: moment().add(3, 'hours').valueOf()
				};
				break;
			case 'evening':
				hideUntil = {
					type: 'timestamp',
					value: (moment().add(3, 'hours').isBefore(todaysEvening) ? todaysEvening : tomorrowsEvening).valueOf()
				};
				break;
			case 'tomorrow':
				hideUntil = {
					type: 'timestamp',
					value: moment().hour(7).startOf('hour').add(1, 'day').valueOf()
				};
				break;
			case 'weekend':
				hideUntil = {
					type: 'timestamp',
					value: moment().day(6).hour(7).startOf('hour').isBefore(moment()) ?
						moment().day(6).hour(7).startOf('hour').add(1, 'week').valueOf() :
						moment().day(6).hour(7).startOf('hour').valueOf()
				};
				break;
			case 'monday':
				hideUntil = {
					type: 'timestamp',
					value: moment().day(1).hour(7).startOf('hour').isBefore(moment()) ?
						moment().day(1).hour(7).startOf('hour').add(1, 'week').valueOf() :
						moment().day(1).hour(7).startOf('hour').valueOf()
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
				hideUntil = { type: 'when-i-have-time' };
				break;
			default:
				updateMessenger.update({
					type: 'error',
					message: 'Forgot to implement ' + $(btnClicked).data('value')
				});
				return;
		}
		$.ajax({
			url: '/api/threads/' + threadId + '/hideUntil',
			data: hideUntil,
			method: 'PUT'
		}).done(function() {
			updateMessenger.update({
				type: 'success',
				message: 'Successfully hid thread ' + threadId + '.'
			});
			$laterPicker.modal('hide');
			deleteThreadFromUI(threadId);
		}).fail(function() {
			updateMessenger.update({
				type: 'error',
				message: 'Failed to hide thread.'
			});
		});
		return false;
	});

	$labelPicker.on('click', 'button', function(eventObject) {
		var threadId = $labelPicker.data('threadId');
		var labelId = $(eventObject.currentTarget).data('label-id');
		var updateMessenger = messengerGetter().info('Moving thread ' + threadId + ' to label...');
		if (!threadId) {
			updateMessenger.update({
				type: 'error',
				message: 'Missing thread id.'
			});
			return;
		}
		moveThreadToLabel(threadId, labelId, updateMessenger).then(function() {
			$labelPicker.modal('hide');
			updateMessenger.update({
				type: 'success',
				message: 'Successfully moved thread ' + threadId + ' to label.'
			});
		}).done();
	});

	$settingsBtn.on('click', function() {
		var islandState = ensureGroupingRulesIsland();
		if (!islandState) {
			messengerGetter().error('Failed to load grouping rules editor');
			return;
		}
		if (!islandState.wasCreated) {
			islandState.instance.refresh();
		}
		$settingsModal.modal('show');
	});
});
