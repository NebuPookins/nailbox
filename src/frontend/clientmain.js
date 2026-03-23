import frontendApi from './index.js';
import { createAppShellController } from './app_shell_controller.js';
import { createThreadListController } from './thread_list_controller.js';
import {
	createThreadActionController,
} from './thread_action_controller.js';
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

	var $threadListRoot = $('#thread-list-root');
	var $authShellStatusRoot = $('#auth-shell-status-root');
	var $authShellControlsRoot = $('#auth-shell-controls-root');
	var $threadViewer = $('#thread-viewer');
	var $threadViewerRoot = $('#thread-viewer-root');
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

	function getThreadViewerThreadId() {
		return threadViewerIsland ? threadViewerIsland.getThreadId() : null;
	}

	function clearThreadViewerState() {
		if (threadViewerIsland) {
			threadViewerIsland.clear();
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
		authShellIsland.setSetupNeeded(message);
		islands.clearThreadList();
	}

	function renderDisconnectedState(message) {
		authShellIsland.setDisconnected(message);
		islands.clearThreadList();
	}

	function renderConnectedState() {
		authShellIsland.setConnectedLoading({ emailAddress: authStatus.emailAddress });
	}

	async function loadLabels() {
		var labels = await appApi.loadLabels();
		labelsCache = labels;
		var labelPickerIslandState = islands.ensureLabelPickerIsland();
		if (labelPickerIslandState) {
			labelPickerIslandState.instance.setLabels(islands.buildLabelPickerLabels());
		}
		var threadListIslandState = islands.ensureThreadListIsland();
		if (threadListIslandState) {
			threadListIslandState.instance.setLabels(labelsCache);
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
			authShellIsland.setIdle();
			groupsOfThreads.forEach(function(group) {
				group.threads.forEach(function(thread) {
					if (thread.needsRefreshing) {
						refreshThreadFromGoogle(thread.threadId);
					}
				});
			});
			var islandState = islands.ensureThreadListIsland();
			if (islandState) {
				islandState.instance.setGroups(groupsOfThreads);
			}
			if (groupsOfThreads.length === 0) {
				authShellIsland.setEmpty();
			}
			updateMessenger.update({
				type: 'success',
				message: 'GUI updated with cached threads.'
			});
		} catch (error) {
			authShellIsland.setError();
			throw error;
		}
	}

	function deleteThreadFromUI(threadId) {
		var islandState = islands.ensureThreadListIsland();
		if (islandState) {
			islandState.instance.removeThread(threadId);
		}
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
		$threadListRoot: $threadListRoot,
		hideSettingsModal: function() { $settingsModal.modal('hide'); },
		hideLabelPicker: function() { $labelPicker.modal('hide'); },
		hideLaterPicker: function() { $laterPicker.modal('hide'); },
		threadActionController: threadActionController,
		getLabels: function() { return labelsCache; },
		deleteThreadFromUI: deleteThreadFromUI,
		updateUiWithThreadsFromServer: updateUiWithThreadsFromServer,
		messengerGetter: messengerGetter,
		reportAsyncError: reportAsyncError,
		onArchiveThread: function(threadId) { threadListController.archiveThread(threadId); },
		onDeleteThread: function(threadId) { threadListController.deleteThread(threadId); },
		onOpenLaterPickerForThread: function(threadSummary) { threadListController.openLaterPicker(threadSummary); },
		onOpenLabelPickerForThread: function(threadSummary) { threadListController.openLabelPicker(threadSummary); },
		onOpenThread: function(threadSummary) { threadListController.openThread(threadSummary); },
	});
	var authShellIsland = frontendApi.mountAuthShellIsland({
		statusContainer: $authShellStatusRoot.get(0),
		authControlsContainer: $authShellControlsRoot.get(0),
		onDisconnect: async function() {
			try {
				await appShellController.disconnectGmail();
			} catch (error) {
				reportAsyncError(error);
			}
		},
		onRefreshNow: async function() {
			try {
				await appShellController.refreshNow();
			} catch (error) {
				reportAsyncError(error);
			}
		},
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
	var threadViewerIsland = frontendApi.mountThreadViewerIsland({
		container: $threadViewerRoot.get(0),
		showModal: function() { $threadViewer.modal('show'); },
		hideModal: function() { $threadViewer.modal('hide'); },
		getEmailAddress: function() { return authStatus.emailAddress; },
		reportError: reportAsyncError,
		onReplyAll: function(opts) {
			return threadViewerController.replyAll(opts);
		},
		onDownloadAttachment: function(opts) {
			return threadViewerController.downloadAttachment({
				attachmentId: opts.attachmentId,
				attachmentName: opts.attachmentName,
				messageId: opts.messageId,
				saveAttachment: function(blob, attachmentName) {
					saveAs(blob, attachmentName);
				},
			});
		},
		onDeleteThread: function(opts) {
			return threadViewerController.deleteCurrentThread(opts);
		},
		onArchiveThread: function(opts) {
			return threadViewerController.archiveCurrentThread(opts);
		},
		onOpenLaterPicker: function(opts) {
			return threadViewerController.showLaterPicker({
				threadId: opts.threadId,
				subject: opts.subject,
				hideModal: opts.hideModal,
				openLaterPicker: showLaterPicker,
			});
		},
		onOpenLabelPicker: function({ threadId, subject, hideThreadViewer }) {
			return threadActionController.switchFromThreadViewerToLabelPicker({
				threadId: threadId,
				subject: subject,
				hideThreadViewer: hideThreadViewer,
				setThreadId: function(tid) {
					var islandState = islands.ensureLabelPickerIsland();
					if (islandState) {
						islandState.instance.open({
							labels: islands.buildLabelPickerLabels(),
							threadId: tid,
						});
					}
				},
				setTitle: function(s) {
					$labelPicker.find('.modal-title').text(s);
				},
				show: function() {
					$labelPicker.modal('show');
				},
			});
		},
		onViewOnGmail: function({ threadId }) {
			return threadViewerController.viewOnGmail({
				threadId: threadId,
				openWindow: function(url, target) { window.open(url, target); },
			});
		},
	});
	function openThreadViewer(threadSummary) {
		return threadViewerIsland.open(threadSummary);
	}
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
		openThreadViewer,
		reportError: reportAsyncError,
		threadActionController: threadActionController,
		threadViewerController: threadViewerController
	});

	wireModals({
		$threadViewer,
		$labelPicker,
		$laterPicker,
		$settingsBtn,
		$settingsModal,
		threadViewerController,
		islands,
		getThreadViewerThreadId,
		clearThreadViewerState,
		messengerGetter,
		reportAsyncError,
	});

	appShellController.initialize().catch(reportAsyncError);
});
