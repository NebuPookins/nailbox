import frontendApi from './index.js';
import {
	renderThreadGroup,
	renderThreadItem,
} from './thread_list_presenter.js';
import {
	createThreadActionController,
	filterSelectableLabels,
} from './thread_action_controller.js';
import {
	renderDeletedMessagesNotice,
	renderThreadMessage,
} from './thread_viewer_presenter.js';
import { createThreadViewerState } from './thread_viewer_state.js';
import { createThreadViewerController } from './thread_viewer_controller.js';

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
	var $labelPickerRoot = $('#label-picker-root');
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
	var labelPickerIsland = null;
	var laterPickerIsland = null;
	var threadViewerState = createThreadViewerState();
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
	var threadViewerController = createThreadViewerController({
		appApi: appApi,
		getThreadData: getThreadData,
		messengerGetter: messengerGetter,
		onError: reportAsyncError,
		onUpdateMessageWordcount: function(threadId, messageId, wordcount) {
			return appApi.updateMessageWordcount(threadId, messageId, wordcount);
		},
		threadActionController: threadActionController
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

	function setThreadViewerThreadId(threadId) {
		threadViewerState.setThreadId(threadId);
		$threadViewer.data('threadId', threadId || null);
	}

	function getThreadViewerThreadId() {
		return threadViewerState.getThreadId();
	}

	function setThreadViewerSubject(subject) {
		threadViewerState.setSubject(subject);
	}

	function getThreadViewerSubject() {
		return threadViewerState.getSubject();
	}

	function clearThreadViewerState() {
		threadViewerState.clear();
		$threadViewer.removeData('threadId');
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
		var islandState = ensureLabelPickerIsland();
		if (islandState) {
			islandState.instance.setLabels(buildLabelPickerLabels());
		}
		return labels;
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
				$main.append($(renderThreadGroup(group)));
				group.threads.forEach(function(thread) {
					if (thread.needsRefreshing) {
						refreshThreadFromGoogle(thread.threadId);
					}
				});
				group.threads.forEach(function(thread) {
					var $thread = $(renderThreadItem(thread, {
						labels: labelsCache,
					}));
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

	function showLabelPickerFromThreadRow($mainBtnClicked, $picker) {
		var $divThread = $mainBtnClicked.parents('.thread[data-thread-id]');
		return threadActionController.openLabelPicker({
			threadId: $divThread.data('threadId'),
			subject: $divThread.find('.subject').text(),
			setThreadId: function(threadId) {
				var islandState = ensureLabelPickerIsland();
				if (islandState) {
					islandState.instance.open({
						labels: buildLabelPickerLabels(),
						threadId: threadId
					});
				}
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
			threadId: getThreadViewerThreadId(),
			subject: getThreadViewerSubject(),
			hideThreadViewer: function() {
				$threadViewer.modal('hide');
			},
			setThreadId: function(threadId) {
				var islandState = ensureLabelPickerIsland();
				if (islandState) {
					islandState.instance.open({
						labels: buildLabelPickerLabels(),
						threadId: threadId
					});
				}
			},
			setTitle: function(subject) {
				$picker.find('.modal-title').text(subject);
			},
			show: function() {
				$picker.modal('show');
			}
		});
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

	function createLabelPickerNotify() {
		return {
			error: function(message) {
				messengerGetter().error(message);
			}
		};
	}

	function buildLabelPickerLabels() {
		return filterSelectableLabels(labelsCache).map(function(label) {
			return {
				...label,
				hue: typeof label.name === 'string' ? (label.name.hashCode() % 360) : 0
			};
		});
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

	function ensureLabelPickerIsland() {
		if (labelPickerIsland) {
			return {
				instance: labelPickerIsland,
				wasCreated: false
			};
		}
		if (!$labelPickerRoot.length) {
			return null;
		}
		if (typeof frontendApi.mountLabelPickerIsland !== 'function') {
			return null;
		}
		labelPickerIsland = frontendApi.mountLabelPickerIsland({
			container: $labelPickerRoot.get(0),
			notify: createLabelPickerNotify(),
			onDismiss: function() {
				$labelPicker.modal('hide');
			},
			onMoveThread: function(threadId, labelId) {
				return threadActionController.moveThreadToLabel(threadId, labelId);
			}
		});
		return {
			instance: labelPickerIsland,
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
		var $threads = $threadViewer.find('.threads');
		await threadViewerController.openThread({
			appendDeletedMessages: function(payload) {
				$threads.append(renderDeletedMessagesNotice(payload));
			},
			appendMessage: function(message) {
				$threads.append(renderThreadMessage(message));
			},
			clearThreads: function() {
				$threads.empty();
			},
			getCurrentThreadId: function() {
				return getThreadViewerThreadId();
			},
			hideLoading: function() {
				$threadViewer.find('.loading-img').hide();
			},
			receiversText: $threadDiv.find('.receivers').attr('title') || '',
			sendersText: $threadDiv.find('.senders').attr('title') || '',
			setReceivers: function(text) {
				$threadViewer.find('.receivers').text(text);
			},
			setSenders: function(text) {
				$threadViewer.find('.senders').text(text);
			},
			setThreadId: function(threadId) {
				setThreadViewerThreadId(threadId);
			},
			setThreadsLoadingText: function(text) {
				$threads.text(text);
			},
			setTitle: function(subject) {
				setThreadViewerSubject(subject);
				$threadViewer.find('.modal-title').text(subject);
			},
			showLoading: function() {
				$threadViewer.find('.loading-img').show();
			},
			showModal: function() {
				$threadViewer.modal('show');
			},
			snippet: $threadDiv.find('.snippet').text(),
			subject: $threadDiv.find('.subject').text(),
			threadId: $threadDiv.data('threadId')
		});
	});

	$threadViewer.find('button.reply-all').on('click', async function() {
		try {
			await threadViewerController.replyAll({
				body: $threadViewer.find('.reply textarea').val(),
				clearReply: function() {
					$threadViewer.find('.reply textarea').val('');
				},
				emailAddress: authStatus.emailAddress,
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				inReplyTo: $threadViewer.find('.threads .message:last').data('messageId'),
				threadId: getThreadViewerThreadId()
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.on('click', 'button.dl-attachment', async function(eventObj) {
		var $clickedButton = $(eventObj.currentTarget);
		try {
			await threadViewerController.downloadAttachment({
				attachmentId: $clickedButton.data('attachment-id'),
				attachmentName: $clickedButton.data('attachment-name'),
				messageId: $clickedButton.parents('.message').data('message-id'),
				saveAttachment: function(blob, attachmentName) {
					saveAs(blob, attachmentName);
				}
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.find('button.delete').on('click', async function() {
		try {
			var result = await threadViewerController.deleteCurrentThread({
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				threadId: getThreadViewerThreadId()
			});
			if (!result || !result.ok) {
				return false;
			}
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$threadViewer.find('button.archive-thread').on('click', async function() {
		try {
			var result = await threadViewerController.archiveCurrentThread({
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				threadId: getThreadViewerThreadId()
			});
			if (!result || !result.ok) {
				return false;
			}
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$threadViewer.find('button.label-thread').on('click', function() {
		return switchFromThreadViewerToLabelPicker($labelPicker);
	});

	$threadViewer.find('button.later').on('click', function() {
		return threadViewerController.showLaterPicker({
			hideModal: function() {
				$threadViewer.modal('hide');
			},
			openLaterPicker: showLaterPicker,
			subject: getThreadViewerSubject(),
			threadId: getThreadViewerThreadId()
		});
	});

	$threadViewer.find('button.view-on-gmail').on('click', function() {
		return threadViewerController.viewOnGmail({
			openWindow: function(url, target) {
				window.open(url, target);
			},
			threadId: getThreadViewerThreadId()
		});
	});

	$threadViewer.on('keydown', async function(event) {
		try {
			await threadViewerController.handleKeydown({
				event: event,
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				isReplyFocused: function() {
					return $threadViewer.find('textarea').is(':focus');
				},
				threadId: getThreadViewerThreadId()
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.on('hidden.bs.modal', function() {
		clearThreadViewerState();
	});

	$labelPicker.on('hidden.bs.modal', function() {
		if (labelPickerIsland && typeof labelPickerIsland.clear === 'function') {
			labelPickerIsland.clear();
		}
	});

	$laterPicker.on('hidden.bs.modal', function() {
		if (laterPickerIsland && typeof laterPickerIsland.clear === 'function') {
			laterPickerIsland.clear();
		}
	});

	$main.on('click', 'a.view-on-gmail', function(eventObject) {
		eventObject.stopPropagation();
		return true;
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
