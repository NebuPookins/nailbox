import frontendApi from './index.js';
import { showModal, hideModal } from './native_modal.js';
import { createMessenger } from './messenger_shim.js';
import { createAppShellController } from './app_shell_controller.js';
import { createThreadListController } from './thread_list_controller.js';
import {
	createThreadActionController,
} from './thread_action_controller.js';
import { createThreadViewerController } from './thread_viewer_controller.js';
import { createIslandManager } from './island_manager.js';
import { wireModals } from './modal_wiring.js';

declare const saveAs: (blob: Blob, name: string) => void;

// String.prototype.hashCode is declared in string_extensions.d.ts

interface AuthStatus {
	configured: boolean;
	connected: boolean;
	emailAddress: string | null;
	scopes: string[];
}

interface LabelItem {
	id: string;
	name?: string;
	type?: string;
	labelListVisibility?: string;
	hue?: number;
}

interface AppError {
	code?: string;
	message?: string;
}

document.addEventListener('DOMContentLoaded', function() {
	'use strict';

	if (!console) {
		(window as unknown as Record<string, unknown>).console = {};
	}
	if (!console.log) {
		console.log = function() {};
	}

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

	function reportAsyncError(error: unknown): void {
		if (error) {
			console.log(error);
		}
	}

	function getThreadViewerThreadId(): string | null {
		return threadViewerIsland ? threadViewerIsland.getThreadId() : null;
	}

	function clearThreadViewerState(): void {
		if (threadViewerIsland) {
			threadViewerIsland.clear();
		}
	}

	function handleApiError(error: AppError | null | undefined, fallbackMessage?: string | null): void {
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

	async function loadLabels(): Promise<LabelItem[]> {
		var labels = await appApi.loadLabels() as LabelItem[];
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

	async function syncThreadsFromGoogle(updateMessenger: { update(opts: { type: string; message: string }): void }): Promise<unknown> {
		updateMessenger = updateMessenger || messengerGetter().info('Syncing Gmail...');
		updateMessenger.update({
			type: 'info',
			message: 'Syncing Gmail to local cache...'
		});
		var resp = await appApi.syncThreadsFromGoogle() as { syncedThreadCount?: number; results?: Array<{ status: number; threadId: string }> };
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

	async function refreshThreadFromGoogle(threadId: string): Promise<void> {
		try {
			await appApi.refreshThread(threadId);
		} catch (error) {
			console.log('Failed to refresh thread', threadId);
		}
	}

	async function updateUiWithThreadsFromServer(updateMessenger: { update(opts: { type: string; message: string }): void }): Promise<void> {
		updateMessenger = updateMessenger || messengerGetter().info('Refreshing threads from cache...');
		updateMessenger.update({
			type: 'info',
			message: 'Downloading threads from local cache...'
		});
		try {
			var groupsOfThreads = await appApi.loadGroupedThreads() as Array<{ threads: Array<{ threadId?: string; needsRefreshing?: boolean }>; items?: Array<{ type?: string; threadId?: string; needsRefreshing?: boolean }> }>;
			authShellIsland.setIdle();
			groupsOfThreads.forEach(function(group) {
				const itemsToCheck: Array<{ type?: string; threadId?: string; needsRefreshing?: boolean }> = group.items
					? group.items
					: group.threads;
				itemsToCheck.forEach(function(item) {
					if (item.type !== 'bundle' && item.needsRefreshing) {
						refreshThreadFromGoogle(item.threadId ?? '');
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

	function deleteThreadFromUI(threadId: string): void {
		var islandState = islands.ensureThreadListIsland();
		if (islandState) {
			islandState.instance.removeThread(threadId);
		}
	}

	async function getThreadData(threadId: string, attemptNumber: number, updateMessenger: { update(opts: { type: string; message: string }): void }): Promise<{ messages: Array<{ messageId: string; deleted?: boolean; timeToReadSeconds?: number; wordcount?: number; [key: string]: unknown }> }> {
		try {
			return await appApi.getThreadData(threadId) as { messages: Array<{ messageId: string; deleted?: boolean; timeToReadSeconds?: number; wordcount?: number; [key: string]: unknown }> };
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
			onHideThread: async function(selectedThreadId: string, hideUntil: { type: string; value?: number }) {
				var updateMsg = messengerGetter().info('Hiding thread ' + selectedThreadId + '.');
				await appApi.hideThread(selectedThreadId, hideUntil);
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
			onHideBundle: async function(selectedBundleId: string, hideUntil: { type: string; value?: number }) {
				var updateMsg = messengerGetter().info('Hiding bundle ' + selectedBundleId + '.');
				await appApi.hideBundle(selectedBundleId, hideUntil);
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

	var appApi = frontendApi.createAppApi({
		onApiError: function(error) {
			handleApiError(error as AppError, error && error.message);
		}
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
		reportAsyncError: reportAsyncError,
		onArchiveThread: function(threadId) { threadListController.archiveThread(threadId); },
		onDeleteThread: function(threadId) { threadListController.deleteThread(threadId); },
		onOpenLaterPickerForThread: function(threadSummary) { threadListController.openLaterPicker(threadSummary as { threadId?: string; subject?: string }); },
		onOpenLabelPickerForThread: function(threadSummary) { threadListController.openLabelPicker(threadSummary as { threadId?: string; subject?: string }); },
		onOpenThread: function(threadSummary) { threadListController.openThread(threadSummary as { threadId?: string; subject?: string }); },
		onCreateBundle: async function(threadIds: string[]) {
			try {
				await appApi.createBundle(threadIds);
				await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing...'));
			} catch (error) {
				reportAsyncError(error);
			}
		},
		onEditBundle: async function(bundleId: string, threadIds: string[]) {
			try {
				await appApi.updateBundle(bundleId, threadIds);
				await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing...'));
			} catch (error) {
				reportAsyncError(error);
			}
		},
		onArchiveBundle: function(bundleId: string) { threadListController.archiveBundle(bundleId); },
		onOpenLaterPickerForBundle: function(bundleSummary) { showLaterPickerForBundle((bundleSummary as { bundleId: string }).bundleId); },
		onUngroup: async function(bundleId: string) {
			try {
				await threadListController.ungroup(bundleId);
				await updateUiWithThreadsFromServer(messengerGetter().info('Refreshing...'));
			} catch (error) {
				reportAsyncError(error);
			}
		},
	});
	var authShellIsland = frontendApi.mountAuthShellIsland({
		statusContainer: authShellStatusRoot,
		authControlsContainer: authShellControlsRoot,
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
			return appApi.updateMessageWordcount(threadId, messageId, wordcount ?? 0);
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
			authStatus = nextAuthStatus as AuthStatus;
		},
		syncThreadsFromGoogle: syncThreadsFromGoogle,
		updateUiWithThreadsFromServer: updateUiWithThreadsFromServer
	});
	var threadViewerIsland = frontendApi.mountThreadViewerIsland({
		container: threadViewerRoot,
		showModal: function() { showModal(threadViewer); },
		hideModal: function() { hideModal(threadViewer); },
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
	function openThreadViewer(threadSummary: { threadId?: string; subject?: string; [key: string]: unknown }) {
		return threadViewerIsland.open(threadSummary as Parameters<typeof threadViewerIsland.open>[0]);
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
		openLaterPickerForBundle: function(bundleSummary) { showLaterPickerForBundle((bundleSummary as { bundleId: string }).bundleId); },
		openThreadViewer,
		reportError: reportAsyncError,
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
		reportAsyncError,
	});

	appShellController.initialize().catch(reportAsyncError);
});
