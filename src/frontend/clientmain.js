import frontendApi from './index.js';
import {
	renderConnectedContent,
	renderDisconnectedContent,
	renderSetupNeededContent,
} from './auth_status_presenter.js';
import { createAppShellController } from './app_shell_controller.js';
import {
	renderThreadGroup,
	renderThreadItem,
} from './thread_list_presenter.js';
import { createThreadListController } from './thread_list_controller.js';
import {
	createThreadActionController,
} from './thread_action_controller.js';
import {
	renderDeletedMessagesNotice,
	renderThreadMessage,
} from './thread_viewer_presenter.js';
import { createThreadViewerState } from './thread_viewer_state.js';
import { createThreadViewerController } from './thread_viewer_controller.js';
import { createIslandManager } from './island_manager.js';
import { wireModals } from './modal_wiring.js';

$(function() {
	'use strict';

	if (!console) {
		console = {};
	}
	if (!console.log) {
		console.log = function() {};
	}

	if (typeof Messenger !== 'undefined') {
		Messenger.options = {
			theme: 'air',
			messageDefaults: {
				showCloseButton: true,
				closeButtonText: 'x'
			}
		};
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
	var threadViewerState = createThreadViewerState();

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
		var content = renderSetupNeededContent(message);
		$status.show().html(content.statusHtml);
		$main.empty();
		$authControls.html(content.authControlsHtml);
	}

	function renderDisconnectedState(message) {
		var content = renderDisconnectedContent(message);
		$status.show().html(content.statusHtml);
		$main.empty();
		$authControls.html(content.authControlsHtml);
	}

	function renderConnectedState() {
		var content = renderConnectedContent(authStatus);
		$status.show().html(content.statusHtml);
		$authControls.html(content.authControlsHtml);
	}

	async function loadLabels() {
		var labels = await appApi.loadLabels();
		labelsCache = labels;
		var islandState = islands.ensureLabelPickerIsland();
		if (islandState) {
			islandState.instance.setLabels(islands.buildLabelPickerLabels());
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

	function showLaterPicker(threadId, subject) {
		var islandState = islands.ensureLaterPickerIsland();
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
	var islands = createIslandManager({
		frontendApi: frontendApi,
		$groupingRulesRoot: $groupingRulesRoot,
		$labelPickerRoot: $labelPickerRoot,
		$laterPickerRoot: $laterPickerRoot,
		hideSettingsModal: function() { $settingsModal.modal('hide'); },
		hideLabelPicker: function() { $labelPicker.modal('hide'); },
		hideLaterPicker: function() { $laterPicker.modal('hide'); },
		threadActionController: threadActionController,
		getLabels: function() { return labelsCache; },
		deleteThreadFromUI: deleteThreadFromUI,
		updateUiWithThreadsFromServer: updateUiWithThreadsFromServer,
		messengerGetter: messengerGetter,
		reportAsyncError: reportAsyncError,
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
	var appShellController = createAppShellController({
		appApi: appApi,
		getAuthStatus: function() {
			return authStatus;
		},
		loadLabels: loadLabels,
		messengerGetter: messengerGetter,
		renderConnectedState: renderConnectedState,
		renderDisconnectedState: renderDisconnectedState,
		renderSetupNeededState: renderSetupNeededState,
		reportError: reportAsyncError,
		setAuthStatus: function(nextAuthStatus) {
			authStatus = nextAuthStatus;
		},
		syncThreadsFromGoogle: syncThreadsFromGoogle,
		updateUiWithThreadsFromServer: updateUiWithThreadsFromServer
	});
	var threadListController = createThreadListController({
		openLabelPicker: function(threadSummary) {
			return threadActionController.openLabelPicker({
				threadId: threadSummary.threadId,
				subject: threadSummary.subject,
				setThreadId: function(threadId) {
					var islandState = islands.ensureLabelPickerIsland();
					if (islandState) {
						islandState.instance.open({
							labels: islands.buildLabelPickerLabels(),
							threadId: threadId
						});
					}
				},
				setTitle: function(subject) {
					$labelPicker.find('.modal-title').text(subject);
				},
				show: function() {
					$labelPicker.modal('show');
				}
			});
		},
		openLaterPicker: showLaterPicker,
		openThreadViewer: function(threadSummary) {
			var $threads = $threadViewer.find('.threads');
			return {
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
				receiversText: threadSummary.receiversText,
				sendersText: threadSummary.sendersText,
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
				snippet: threadSummary.snippet,
				subject: threadSummary.subject,
				threadId: threadSummary.threadId
			};
		},
		reportError: reportAsyncError,
		threadActionController: threadActionController,
		threadViewerController: threadViewerController
	});

	wireModals({
		$main,
		$authControls,
		$threadViewer,
		$labelPicker,
		$laterPicker,
		$settingsBtn,
		$settingsModal,
		appShellController,
		threadListController,
		threadViewerController,
		threadActionController,
		islands,
		getThreadViewerThreadId,
		getThreadViewerSubject,
		clearThreadViewerState,
		showLaterPicker,
		messengerGetter,
		reportAsyncError,
		getAuthStatus: function() { return authStatus; },
	});

	appShellController.initialize().catch(reportAsyncError);
});
