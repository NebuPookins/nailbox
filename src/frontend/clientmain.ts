import frontendApi from './index.js';
import { showModal, hideModal } from './native_modal.js';
import { createMessenger, type MsgHandle } from './messenger_shim.js';
import { createAppShellController } from './app_shell_controller.js';
import { createThreadListController } from './thread_list_controller.js';
import {
	createThreadActionController,
} from './thread_action_controller.js';
import { createThreadViewerController } from './thread_viewer_controller.js';
import { createIslandManager } from './island_manager.js';
import { wireModals } from './modal_wiring.js';
import { createThreadUpdatesSocket } from './thread_updates_socket.js';
import { type GroupingRulesConfig } from './thread_grouping.js';
import type { Result, ThreadDataResponse } from './api.js';
import type { LabelResponse, HideUntilValue, AppApi } from './api.js';

declare const saveAs: (blob: Blob, name: string) => void;

// String.prototype.hashCode is declared in string_extensions.d.ts

interface AuthStatus {
	configured: boolean;
	connected: boolean;
	emailAddress: string | null;
	scopes: string[];
}

type LabelItem = LabelResponse & { hue?: number };

document.addEventListener('DOMContentLoaded', function() {
	var messengerGetter = (function() {
		var messenger = createMessenger();
		return function() { return messenger; };
	})();

	var threadListRoot = document.getElementById('thread-list-root');
	var authShellStatusRoot = document.getElementById('auth-shell-status-root')!;
	var authShellControlsRoot = document.getElementById('auth-shell-controls-root')!;
	var threadViewer = document.getElementById('thread-viewer')!;
	var threadViewerRoot = document.getElementById('thread-viewer-root')!;
	var labelPicker = document.getElementById('label-picker')!;
	var labelPickerRoot = document.getElementById('label-picker-root');
	var laterPicker = document.getElementById('later-picker')!;
	var laterPickerRoot = document.getElementById('later-picker-root');
	var settingsBtn = document.getElementById('settings-btn')!;
	var settingsModal = document.getElementById('settings-modal')!;
	var groupingRulesRoot = document.getElementById('grouping-rules-root');

	var authStatus: AuthStatus = {
		configured: false,
		connected: false,
		emailAddress: null,
		scopes: []
	};
	var labelsCache: LabelItem[] = [];
	var groupingRulesCache: GroupingRulesConfig = { rules: [] };
	var threadRefreshInFlight = false;
	var pendingThreadRefresh = false;

	String.prototype.hashCode = function(this: string): number {
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

	function getThreadViewerThreadId(): string | null {
		return threadViewerIsland ? threadViewerIsland.getThreadId() : null;
	}

	function clearThreadViewerState(): void {
		if (threadViewerIsland) {
			threadViewerIsland.clear();
		}
	}

function renderSetupNeededState(message?: string): void {
		authShellIsland.setSetupNeeded(message);
		islands.clearThreadList();
	}

	function renderDisconnectedState(message?: string): void {
		authShellIsland.setDisconnected(message);
		islands.clearThreadList();
	}

	function renderConnectedState(): void {
		authShellIsland.setConnectedLoading({ emailAddress: authStatus.emailAddress });
	}

	async function loadLabels(): Promise<Result<void>> {
		const result = await appApi.loadLabels();
		if (!result.ok) {
			return result;
		}
		labelsCache = result.value;
		var labelPickerIslandState = islands.ensureLabelPickerIsland();
		if (labelPickerIslandState) {
			labelPickerIslandState.instance.setLabels(islands.buildLabelPickerLabels());
		}
		var threadListIslandState = islands.ensureThreadListIsland();
		if (threadListIslandState) {
			threadListIslandState.instance.setLabels(labelsCache);
		}
		return { ok: true, value: undefined };
	}

	async function loadGroupingRules(): Promise<void> { //TODO: Use Result instead of throwing error.
		var rulesApi = frontendApi.createGroupingRulesApi();
		var response = await rulesApi.loadRules();
		if (!response.ok) {
			throw response.error instanceof Error ? response.error : new Error('Failed to load grouping rules.');
		}
		groupingRulesCache = response.value;
		var threadListIslandState = islands.ensureThreadListIsland();
		if (threadListIslandState) {
			threadListIslandState.instance.setGroupingRules(groupingRulesCache);
		}
	}

	async function syncThreadsFromGoogle(updateMessenger: MsgHandle): Promise<void> {
		updateMessenger = updateMessenger || messengerGetter().info('Syncing Gmail...');
		updateMessenger.update({
			type: 'info',
			message: 'Syncing Gmail to local cache...'
		});
		const result = await appApi.syncThreadsFromGoogle();
		if (!result.ok) {
			updateMessenger.update({
				type: 'error',
				message: 'Failed to sync Gmail: ' + (result.error?.message || String(result.error))
			});
			return;
		}
		var resp = result.value;
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
			return;
		}
		updateMessenger.update({
			type: 'success',
			message: 'Synced ' + resp.syncedThreadCount + ' Gmail threads.'
		});
	}

	async function updateUiWithThreadsFromServer(updateMessenger: MsgHandle): Promise<void> {
		updateMessenger = updateMessenger || messengerGetter().info('Refreshing threads from cache...');
		updateMessenger.update({
			type: 'info',
			message: 'Downloading threads from local cache...'
		});
		const result = await appApi.loadGroupedThreads();
		if (!result.ok) {
			authShellIsland.setError();
			updateMessenger.update({
				type: 'error',
				message: 'Failed to load threads: ' + (result.error?.message || String(result.error))
			});
			return;
		}
		const groupsOfThreads = result.value;

		authShellIsland.setIdle();
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
	}

	async function refreshThreadsFromServerCoalesced(updateMessenger: MsgHandle): Promise<void> {
		if (threadRefreshInFlight) {
			pendingThreadRefresh = true;
			return;
		}
		threadRefreshInFlight = true;
		try {
			await updateUiWithThreadsFromServer(updateMessenger);
		} finally {
			threadRefreshInFlight = false;
			if (pendingThreadRefresh) {
				pendingThreadRefresh = false;
				await refreshThreadsFromServerCoalesced(messengerGetter().info('Refreshing threads from cache...'));
			}
		}
	}

	function deleteThreadFromUI(threadId: string): void {
		var islandState = islands.ensureThreadListIsland();
		if (islandState) {
			islandState.instance.removeThread(threadId);
		}
	}

	async function getThreadData(threadId: string, attemptNumber: number, updateMessenger: MsgHandle): Promise<Result<ThreadDataResponse>> {
		const result = await appApi.getThreadData(threadId);
		if (!result.ok) {
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
			return { ok: false, error: result.error };
		}
		return { ok: true, value: result.value };
	}

	function showLaterPicker(threadId: string, subject: string): boolean {
		var islandState = islands.ensureLaterPickerIsland();
		if (!threadId) {
			messengerGetter().error('Missing thread id.');
			return false;
		}
		if (!islandState) {
			messengerGetter().error('Failed to load later picker');
			return false;
		}
		laterPicker.querySelector('.modal-title')!.textContent = subject || '';
		islandState.instance.open({
			onHideThread: async function(selectedThreadId: string, hideUntil: HideUntilValue) {
				var updateMsg = messengerGetter().info('Hiding thread ' + selectedThreadId + '.');
				const result = await appApi.hideThread(selectedThreadId, hideUntil);
				if (!result.ok) {
					updateMsg.update({ type: 'error', message: result.error.message || 'Failed to hide thread.' });
					return;
				}
				updateMsg.update({
					type: 'success',
					message: 'Successfully hid thread ' + selectedThreadId + '.'
				});
			},
			threadId: threadId
		});
		showModal(laterPicker);
		return false;
	}

	function showLabelPickerForBundle(bundleId: string): boolean {
		var islandState = islands.ensureLabelPickerIsland();
		if (!bundleId) {
			messengerGetter().error('Missing bundle id.');
			return false;
		}
		if (!islandState) {
			messengerGetter().error('Failed to load label picker');
			return false;
		}
		labelPicker.querySelector('.modal-title')!.textContent = 'Label Bundle';
		islandState.instance.openForBundle({
			labels: islands.buildLabelPickerLabels(),
			bundleId: bundleId,
		});
		showModal(labelPicker);
		return false;
	}

	function showLaterPickerForBundle(bundleId: string): boolean {
		var islandState = islands.ensureLaterPickerIsland();
		if (!bundleId) {
			messengerGetter().error('Missing bundle id.');
			return false;
		}
		if (!islandState) {
			messengerGetter().error('Failed to load later picker');
			return false;
		}
		laterPicker.querySelector('.modal-title')!.textContent = 'Bundle';
		islandState.instance.openForBundle({
			bundleId: bundleId,
			onHideBundle: async function(selectedBundleId: string, hideUntil: HideUntilValue) {
				var updateMsg = messengerGetter().info('Hiding bundle ' + selectedBundleId + '.');
				const result = await appApi.hideBundle(selectedBundleId, hideUntil);
				if (!result.ok) {
					updateMsg.update({ type: 'error', message: result.error.message || 'Failed to hide bundle.' });
					return;
				}
				var threadListIslandState = islands.ensureThreadListIsland();
				if (threadListIslandState) {
					threadListIslandState.instance.removeBundleRow(selectedBundleId);
				}
				updateMsg.update({
					type: 'success',
					message: 'Bundle hidden.'
				});
			},
		});
		showModal(laterPicker);
		return false;
	}

	var appApi: AppApi = frontendApi.createAppApi();
	var threadUpdatesConnection = createThreadUpdatesSocket({
		onThreadsChanged: function() {
			if (!authStatus.connected) {
				return;
			}
			refreshThreadsFromServerCoalesced(
				messengerGetter().info('Refreshing threads from cache...')
			).catch(function(error: unknown) {
				messengerGetter().error(error instanceof Error ? error.message : String(error));
			});
		},
		reportError: function(error: unknown) {
			messengerGetter().error(error instanceof Error ? error.message : String(error));
		},
	});
	function deleteBundleFromUI(bundleId: string): void {
		var islandState = islands.ensureThreadListIsland();
		if (islandState) {
			islandState.instance.removeBundleRow(bundleId);
		}
	}

	var threadActionController = createThreadActionController({
		appApi: appApi,
		messengerGetter: messengerGetter,
		onThreadRemoved: deleteThreadFromUI,
		onBundleRemoved: deleteBundleFromUI,
	});
	var islands = createIslandManager({
		frontendApi: frontendApi,
		groupingRulesRoot: groupingRulesRoot,
		labelPickerRoot: labelPickerRoot,
		laterPickerRoot: laterPickerRoot,
		threadListRoot: threadListRoot,
		hideSettingsModal: function() { hideModal(settingsModal); },
		hideLabelPicker: function() { hideModal(labelPicker); },
		hideLaterPicker: function() { hideModal(laterPicker); },
		threadActionController: threadActionController,
		getLabels: function() { return labelsCache; },
		deleteThreadFromUI: deleteThreadFromUI,
		updateUiWithThreadsFromServer: updateUiWithThreadsFromServer,
		messengerGetter: messengerGetter,
		reportAsyncError: function(error: unknown) {
			messengerGetter().error(error instanceof Error ? error.message : String(error));
		},
		onArchiveThread: function(threadId) { threadListController.archiveThread(threadId); },
		onDeleteThread: function(threadId) { threadListController.deleteThread(threadId); },
		onOpenLaterPickerForThread: function(threadSummary) { threadListController.openLaterPicker(threadSummary); },
		onOpenLabelPickerForThread: function(threadSummary) { threadListController.openLabelPicker(threadSummary); },
		onOpenThread: function(threadSummary) { threadListController.openThread(threadSummary); },
		onCreateBundle: async function(threadIds: string[]) {
			const result = await appApi.createBundle(threadIds);
			if (!result.ok) {
				messengerGetter().error(result.error.message);
				return;
			}
			var threadListIslandState = islands.ensureThreadListIsland();
			if (threadListIslandState && result.value.bundleId) {
				threadListIslandState.instance.createBundleRow(result.value.bundleId, threadIds);
			}
		},
		onEditBundle: async function(bundleId: string, threadIds: string[], mergeBundleIds: string[]) {
			const result = await appApi.updateBundle(bundleId, threadIds, mergeBundleIds);
			if (!result.ok) {
				messengerGetter().error(result.error.message);
				return;
			}
			var threadListIslandState = islands.ensureThreadListIsland();
			if (threadListIslandState) {
				threadListIslandState.instance.updateBundleRow(bundleId, threadIds, mergeBundleIds);
			}
		},
		onArchiveBundle: function(bundleId: string) { threadListController.archiveBundle(bundleId); },
		onGroupingRulesSaved: loadGroupingRules,
		onOpenLaterPickerForBundle: function(bundleSummary) { showLaterPickerForBundle(bundleSummary.bundleId); },
		onOpenLabelPickerForBundle: function(bundleSummary) { showLabelPickerForBundle(bundleSummary.bundleId); },
		onMoveBundle: async function(bundleId: string, labelId: string) {
			var updateMsg = messengerGetter().info('Labeling bundle ' + bundleId + '...');
			const result = await appApi.addLabelToBundle(bundleId, labelId);
			if (!result.ok) {
				updateMsg.update({ type: 'error', message: result.error.message || 'Failed to label bundle.' });
				return;
			}
			var threadListIslandState = islands.ensureThreadListIsland();
			if (threadListIslandState) {
				threadListIslandState.instance.removeBundleRow(bundleId);
			}
			updateMsg.update({
				type: 'success',
				message: 'Bundle labeled and removed from inbox.'
			});
		},
		onUngroup: async function(bundleId: string) {
			var updateMsg = messengerGetter().info('Ungrouping bundle ' + bundleId + '...');
			const result = await appApi.deleteBundle(bundleId);
			if (!result.ok) {
				updateMsg.update({ type: 'error', message: result.error.message || 'Failed to ungroup bundle.' });
				return;
			}
			var threadListIslandState = islands.ensureThreadListIsland();
			if (threadListIslandState) {
				threadListIslandState.instance.ungroupBundleRow(bundleId);
			}
			updateMsg.update({
				type: 'success',
				message: 'Bundle ungrouped.'
			});
		},
	});
	var authShellIsland = frontendApi.mountAuthShellIsland({
		statusContainer: authShellStatusRoot,
		authControlsContainer: authShellControlsRoot,
		onDisconnect: async function() {
			try {
				await appShellController.disconnectGmail();
			} catch (error) {
				messengerGetter().error(error instanceof Error ? error.message : String(error));
			}
		},
		onRefreshNow: async function() {
			try {
				await appShellController.refreshNow();
			} catch (error) {
				messengerGetter().error(error instanceof Error ? error.message : String(error));
			}
		},
	});
	var threadViewerController = createThreadViewerController({
		appApi: appApi,
		getThreadData: getThreadData,
		messengerGetter: messengerGetter,
		onUpdateMessageWordcount: function(threadId, messageId, wordcount) {
			return appApi.updateMessageWordcount(threadId, messageId, wordcount ?? 0);
		},
		threadActionController: threadActionController
	});
	var appShellController = createAppShellController({
		appApi,
		getAuthStatus: function() {
			return authStatus;
		},
		loadGroupingRules,
		loadLabels,
		messengerGetter,
		renderConnectedState,
		renderDisconnectedState,
		renderSetupNeededState,
		setAuthStatus: function(nextAuthStatus) {
			authStatus = nextAuthStatus as AuthStatus;
		},
		syncThreadsFromGoogle,
		threadUpdatesConnection,
		updateUiWithThreadsFromServer,
	});
	var threadViewerIsland = frontendApi.mountThreadViewerIsland({
		container: threadViewerRoot,
		showModal: function() { showModal(threadViewer); },
		hideModal: function() { hideModal(threadViewer); },
		getEmailAddress: function() { return authStatus.emailAddress; },
		reportError: function(error: unknown) {
			messengerGetter().error(error instanceof Error ? error.message : String(error));
		},
		onReplyAll: async function(opts) {
			await threadViewerController.replyAll(opts);
		},
		onDownloadAttachment: async function(opts) {
			await threadViewerController.downloadAttachment({
				attachmentId: opts.attachmentId,
				attachmentName: opts.attachmentName,
				messageId: opts.messageId,
				saveAttachment: function(blob, attachmentName) {
					saveAs(blob, attachmentName);
				},
			});
		},
		onDeleteThread: async function(opts) {
			await threadViewerController.deleteCurrentThread(opts);
		},
		onArchiveThread: async function(opts) {
			await threadViewerController.archiveCurrentThread(opts);
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
					labelPicker.querySelector('.modal-title')!.textContent = s;
				},
				show: function() {
					showModal(labelPicker);
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
	function openThreadViewer(threadSummary: { threadId?: string; subject?: string; snippet?: string; sendersText?: string; receiversText?: string }) {
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
					labelPicker.querySelector('.modal-title')!.textContent = subject;
				},
				show: function() {
					showModal(labelPicker);
				}
			});
		},
		openLaterPicker: showLaterPicker,
		openLaterPickerForBundle: function(bundleSummary) { showLaterPickerForBundle(bundleSummary.bundleId); },
		openThreadViewer,
		reportError: function(error: unknown) {
			messengerGetter().error(error instanceof Error ? error.message : String(error));
		},
		threadActionController: threadActionController,
		threadViewerController: threadViewerController
	});

	wireModals({
		threadViewer,
		labelPicker,
		laterPicker,
		settingsBtn,
		settingsModal,
		threadViewerController,
		islands,
		getThreadViewerThreadId,
		clearThreadViewerState,
		messengerGetter,
		reportAsyncError: function(error: unknown) {
			messengerGetter().error(error instanceof Error ? error.message : String(error));
		},
	});

	appShellController.initialize().then(result => {
		if (!result.ok) {
			messengerGetter().error(result.error.message);
		}
	}).catch(function(error: unknown) {
		messengerGetter().error(error instanceof Error ? error.message : String(error));
	});
});
