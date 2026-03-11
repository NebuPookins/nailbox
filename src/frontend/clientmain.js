import frontendApi from './index.js';
import {
	createThreadActionController,
	filterSelectableLabels,
} from './thread_action_controller.js';

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
	var $laterPickerRoot = $('#later-picker-root');
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
	var laterPickerIsland = null;
	var appApi = frontendApi.createAppApi({
		onApiError: function(error) {
			handleApiError(error, error && error.message);
		}
	});
	var threadActionController = createThreadActionController({
		appApi: appApi,
		messengerGetter: messengerGetter,
		onThreadRemoved: deleteThreadFromUI
	});

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
			hash |= 0;
		}
		return hash;
	};

	function reportAsyncError(error) {
		if (error) {
			console.log(error);
		}
	}

	function handleApiError(error, fallbackMessage) {
		if (error && error.code === 'GOOGLE_REAUTH_REQUIRED') {
			authStatus.connected = false;
			authStatus.emailAddress = null;
			renderDisconnectedState('Google authorization expired. Reconnect Gmail to continue.');
			return;
		}
		if (error && error.code === 'GOOGLE_AUTH_MISCONFIGURED') {
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

	async function loadAuthStatus() {
		var status = await appApi.loadAuthStatus();
		authStatus = status;
		return status;
	}

	async function loadLabels() {
		var labels = await appApi.loadLabels();
		labelsCache = labels;
		populateLabelPicker();
		return labels;
	}

	function populateLabelPicker() {
		var $labelList = $labelPicker.find('ul.label-list');
		$labelList.empty();
		filterSelectableLabels(labelsCache)
			.forEach(function(label) {
				$labelList.append(handlebarsTemplates.labelSelection({
					id: label.id,
					isSystem: label.type === 'system',
					hue: (label.name.hashCode() % 360)
				}));
			});
	}

	async function syncThreadsFromGoogle(updateMessenger) {
		updateMessenger = updateMessenger || messengerGetter().info('Syncing Gmail...');
		updateMessenger.update({
			type: 'info',
			message: 'Syncing Gmail to local cache...'
		});
		var resp = await appApi.syncThreadsFromGoogle();
		var failedResults = Array.isArray(resp.results) ? resp.results.filter(function(result) {
			return result.status >= 400;
		}) : [];
		if (failedResults.length > 0) {
			var displayedThreadIds = failedResults.slice(0, 5).map(function(result) {
				return result.threadId;
			});
			var moreCount = failedResults.length - displayedThreadIds.length;
			var details = displayedThreadIds.join(', ');
			if (moreCount > 0) {
				details += ' +' + moreCount + ' more';
			}
			updateMessenger.update({
				type: 'error',
				message: 'Synced ' + resp.syncedThreadCount + ' Gmail threads, but ' +
					failedResults.length + ' failed: ' + details + '.'
			});
			return resp;
		}
		updateMessenger.update({
			type: 'success',
			message: 'Synced ' + resp.syncedThreadCount + ' Gmail threads.'
		});
		return resp;
	}

	async function refreshThreadFromGoogle(threadId) {
		try {
			await appApi.refreshThread(threadId);
		} catch (error) {
			console.log('Failed to refresh thread', threadId);
		}
	}

	async function updateUiWithThreadsFromServer(updateMessenger) {
		updateMessenger = updateMessenger || messengerGetter().info('Refreshing threads from cache...');
		updateMessenger.update({
			type: 'info',
			message: 'Downloading threads from local cache...'
		});
		try {
			var groupsOfThreads = await appApi.loadGroupedThreads();
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
						return labelId !== 'INBOX' &&
							labelId !== 'UNREAD' &&
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
		} catch (error) {
			$status.show().html(
				'<h1>Failed to load cached mail</h1>' +
				'<p>Check the server logs, then try syncing Gmail again.</p>'
			);
			throw error;
		}
	}

	function deleteThreadFromUI(threadId) {
		var $uiElemToDelete = $main.find('.thread[data-thread-id="' + threadId + '"]');
		$uiElemToDelete.hide(400, function() {
			$uiElemToDelete.remove();
		});
	}

	async function getThreadData(threadId, attemptNumber, updateMessenger) {
		try {
			return await appApi.getThreadData(threadId);
		} catch (error) {
			if (attemptNumber < 60) {
				updateMessenger.update({
					type: 'info',
					message: 'Failed to get thread data, retrying...'
				});
				return getThreadData(threadId, attemptNumber + 1, updateMessenger);
			}
			updateMessenger.update({
				type: 'error',
				message: 'Failed to get thread data after too many retries.'
			});
			throw error;
		}
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

	function showLabelPickerFromThreadRow($mainBtnClicked, $picker) {
		var $divThread = $mainBtnClicked.parents('.thread[data-thread-id]');
		return threadActionController.openLabelPicker({
			threadId: $divThread.data('threadId'),
			subject: $divThread.find('.subject').text(),
			setThreadId: function(threadId) {
				$picker.data('threadId', threadId);
			},
			setTitle: function(subject) {
				$picker.find('.modal-title').text(subject);
			},
			show: function() {
				$picker.modal('show');
			}
		});
	}

	function showLaterPicker(threadId, subject) {
		var islandState = ensureLaterPickerIsland();
		if (!threadId) {
			messengerGetter().error('Missing thread id.');
			return false;
		}
		if (!islandState) {
			messengerGetter().error('Failed to load later picker');
			return false;
		}
		$laterPicker.find('.modal-title').text(subject || '');
		$laterPicker.data('threadId', threadId);
		islandState.instance.open({
			onHideThread: async function(selectedThreadId, hideUntil) {
				var updateMessenger = messengerGetter().info('Hiding thread ' + selectedThreadId + '.');
				await appApi.hideThread(selectedThreadId, hideUntil);
				updateMessenger.update({
					type: 'success',
					message: 'Successfully hid thread ' + selectedThreadId + '.'
				});
			},
			threadId: threadId
		});
		$laterPicker.modal('show');
		return false;
	}

	function switchFromThreadViewerToLabelPicker($picker) {
		return threadActionController.switchFromThreadViewerToLabelPicker({
			threadId: $threadViewer.data('threadId'),
			subject: $threadViewer.find('.modal-title').text(),
			hideThreadViewer: function() {
				$threadViewer.modal('hide');
			},
			setThreadId: function(threadId) {
				$picker.data('threadId', threadId);
			},
			setTitle: function(subject) {
				$picker.find('.modal-title').text(subject);
			},
			show: function() {
				$picker.modal('show');
			}
		});
	}

	function showLaterPickerFromThreadViewer() {
		var threadId = $threadViewer.data('threadId');
		if (!threadId) {
			messengerGetter().error('Missing thread id.');
			return false;
		}
		$threadViewer.modal('hide');
		return showLaterPicker(threadId, $threadViewer.find('.modal-title').text());
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

	function createLaterPickerNotify() {
		return {
			error: function(message) {
				messengerGetter().error(message);
			}
		};
	}

	function ensureGroupingRulesIsland() {
		if (groupingRulesIsland) {
			return {
				instance: groupingRulesIsland,
				wasCreated: false
			};
		}
		if (!$groupingRulesRoot.length) {
			return null;
		}
		if (typeof frontendApi.mountGroupingRulesSettings !== 'function') {
			return null;
		}
		groupingRulesIsland = frontendApi.mountGroupingRulesSettings({
			container: $groupingRulesRoot.get(0),
			notify: createGroupingRulesNotify(),
			onSaved: function() {
				$settingsModal.modal('hide');
				updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...')).catch(reportAsyncError);
			}
		});
		return {
			instance: groupingRulesIsland,
			wasCreated: true
		};
	}

	function ensureLaterPickerIsland() {
		if (laterPickerIsland) {
			return {
				instance: laterPickerIsland,
				wasCreated: false
			};
		}
		if (!$laterPickerRoot.length) {
			return null;
		}
		if (typeof frontendApi.mountLaterPickerIsland !== 'function') {
			return null;
		}
		laterPickerIsland = frontendApi.mountLaterPickerIsland({
			container: $laterPickerRoot.get(0),
			notify: createLaterPickerNotify(),
			onDismiss: function() {
				$laterPicker.modal('hide');
			},
			onHidden: function(threadId) {
				deleteThreadFromUI(threadId);
			}
		});
		return {
			instance: laterPickerIsland,
			wasCreated: true
		};
	}

	async function bootstrapConnectedApp() {
		renderConnectedState();
		try {
			await updateUiWithThreadsFromServer(messengerGetter().info('Loading cached threads...'));
			try {
				await loadLabels();
			} catch (error) {
				messengerGetter().error('Failed to load Gmail labels. Continuing with cached mail.');
			}
			await syncThreadsFromGoogle(messengerGetter().info('Downloading new threads from Gmail...'));
			await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
		} catch (error) {
			messengerGetter().error('Failed to refresh Gmail. Cached mail is still available.');
		}

		setInterval(function() {
			if (authStatus.connected) {
				updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...')).catch(reportAsyncError);
			}
		}, moment.duration(5, 'minutes').as('milliseconds'));

		setInterval(function() {
			if (authStatus.connected) {
				syncThreadsFromGoogle(messengerGetter().info('Downloading new threads from Gmail...'))
					.then(function() {
						return updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
					})
					.catch(reportAsyncError);
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
		bootstrapConnectedApp().catch(reportAsyncError);
	}).catch(reportAsyncError);

	$authControls.on('click', '#disconnect-gmail-btn', async function() {
		try {
			await appApi.disconnectGmail();
			authStatus.connected = false;
			authStatus.emailAddress = null;
			renderDisconnectedState('Gmail disconnected.');
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$authControls.on('click', '#refresh-now-btn', async function() {
		try {
			await syncThreadsFromGoogle(messengerGetter().info('Syncing Gmail...'));
			await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing threads from cache...'));
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$main.on('click', 'button.delete', async function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		try {
			await threadActionController.deleteThread(threadId);
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$main.on('click', 'button.archive-thread', async function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		var threadId = $divThread.data('threadId');
		try {
			await threadActionController.archiveThread(threadId);
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$main.on('click', 'button.label-thread', function(eventObject) {
		return showLabelPickerFromThreadRow($(eventObject.currentTarget), $labelPicker);
	});

	$main.on('click', 'button.later', function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		return showLaterPicker($divThread.data('threadId'), $divThread.find('.subject').text());
	});

	$main.on('click', 'div.thread', async function(eventObject) {
		if ($(eventObject.target).closest('button, a, input, select, textarea, label').length > 0) {
			return true;
		}
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
		try {
			var threadData = await getThreadData(threadId, 0, updateMessenger);
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
				appApi.updateMessageWordcount(threadId, message.messageId, message.wordcount).catch(reportAsyncError);
			});
			updateMessenger.update({
				type: 'success',
				message: 'Successfully downloaded thread data for ' + threadId + '.'
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.find('button.reply-all').on('click', async function() {
		var threadId = $threadViewer.data('threadId');
		var updateMessenger = messengerGetter().info('Sending reply to thread ' + threadId + '...');
		if (!threadId || !authStatus.emailAddress) {
			updateMessenger.update({
				type: 'error',
				message: 'Missing thread id or authenticated email address.'
			});
			return;
		}
		try {
			var base64EncodedEmail = await appApi.buildRfc2822({
				myEmail: authStatus.emailAddress,
				threadId: threadId,
				body: $threadViewer.find('.reply textarea').val(),
				inReplyTo: $threadViewer.find('.threads .message:last').data('messageId')
			});
			var resp = await appApi.sendMessage({
				threadId: threadId,
				raw: base64EncodedEmail
			});
			updateMessenger.update({
				type: 'success',
				message: 'Successfully sent message with id ' + resp.id + '.'
			});
			$threadViewer.find('.reply textarea').val('');
			$threadViewer.modal('hide');
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.on('click', 'button.dl-attachment', async function(eventObj) {
		var $clickedButton = $(eventObj.currentTarget);
		var attachmentId = $clickedButton.data('attachment-id');
		var attachmentName = $clickedButton.data('attachment-name');
		var messageId = $clickedButton.parents('.message').data('message-id');
		try {
			var resp = await appApi.getAttachment(messageId, attachmentId);
			var base64Version = resp.data.replace(/[-_]/g, function(char) {
				return char === '-' ? '+' : '/';
			});
			saveAs(b64toBlob(base64Version), attachmentName);
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.find('button.delete').on('click', async function() {
		var threadId = $threadViewer.data('threadId');
		try {
			var result = await threadActionController.deleteThread(threadId);
			if (!result || !result.ok) {
				return false;
			}
			$threadViewer.modal('hide');
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$threadViewer.find('button.archive-thread').on('click', async function() {
		var threadId = $threadViewer.data('threadId');
		try {
			var result = await threadActionController.archiveThread(threadId);
			if (!result || !result.ok) {
				return false;
			}
			$threadViewer.modal('hide');
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$threadViewer.find('button.label-thread').on('click', function() {
		return switchFromThreadViewerToLabelPicker($labelPicker);
	});

	$threadViewer.find('button.later').on('click', function() {
		return showLaterPickerFromThreadViewer();
	});

	$threadViewer.find('button.view-on-gmail').on('click', function() {
		var threadId = $threadViewer.data('threadId');
		if (threadId) {
			window.open('https://mail.google.com/mail/u/0/#inbox/' + threadId, '_blank');
		}
		return false;
	});

	$threadViewer.on('keydown', async function(event) {
		if ($threadViewer.find('textarea').is(':focus')) {
			return;
		}
		if (event.key === 'Delete') {
			var threadId = $threadViewer.data('threadId');
			try {
				var result = await threadActionController.deleteThread(threadId);
				if (!result || !result.ok) {
					return;
				}
				$threadViewer.modal('hide');
			} catch (error) {
				reportAsyncError(error);
			}
		}
	});

	$main.on('click', 'a.view-on-gmail', function(eventObject) {
		eventObject.stopPropagation();
		return true;
	});

	$labelPicker.on('click', 'button', async function(eventObject) {
		var threadId = $labelPicker.data('threadId');
		var labelId = $(eventObject.currentTarget).data('label-id');
		try {
			var result = await threadActionController.moveThreadToLabel(threadId, labelId);
			if (!result || !result.ok) {
				return;
			}
			$labelPicker.modal('hide');
		} catch (error) {
			reportAsyncError(error);
		}
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
