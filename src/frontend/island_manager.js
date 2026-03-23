// @ts-nocheck
import { filterSelectableLabels } from './thread_action_controller.js';

/**
 * Manages lazy initialization and caching of React island instances.
 *
 * @param {{
 *   frontendApi: object,
 *   groupingRulesRoot: Element|null,
 *   labelPickerRoot: Element|null,
 *   laterPickerRoot: Element|null,
 *   threadListRoot: Element|null,
 *   hideSettingsModal: () => void,
 *   hideLabelPicker: () => void,
 *   hideLaterPicker: () => void,
 *   threadActionController: object,
 *   getLabels: () => Array,
 *   deleteThreadFromUI: (threadId: string) => void,
 *   updateUiWithThreadsFromServer: (messenger: object) => Promise,
 *   messengerGetter: () => object,
 *   reportAsyncError: (error: Error) => void,
 *   onArchiveThread: (threadId: string) => void,
 *   onDeleteThread: (threadId: string) => void,
 *   onOpenLaterPickerForThread: (threadSummary: object) => void,
 *   onOpenLabelPickerForThread: (threadSummary: object) => void,
 *   onOpenThread: (threadSummary: object) => void,
 * }} deps
 */
export function createIslandManager({
	frontendApi,
	groupingRulesRoot,
	labelPickerRoot,
	laterPickerRoot,
	threadListRoot,
	hideSettingsModal,
	hideLabelPicker,
	hideLaterPicker,
	threadActionController,
	getLabels,
	deleteThreadFromUI,
	updateUiWithThreadsFromServer,
	messengerGetter,
	reportAsyncError,
	onArchiveThread,
	onDeleteThread,
	onOpenLaterPickerForThread,
	onOpenLabelPickerForThread,
	onOpenThread,
}) {
	var groupingRulesIsland = null;
	var labelPickerIsland = null;
	var laterPickerIsland = null;
	var threadListIsland = null;

	function buildLabelPickerLabels() {
		return filterSelectableLabels(getLabels()).map(function(label) {
			return {
				...label,
				hue: typeof label.name === 'string' ? (label.name.hashCode() % 360) : 0
			};
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

	function ensureGroupingRulesIsland() {
		if (groupingRulesIsland) {
			return {
				instance: groupingRulesIsland,
				wasCreated: false
			};
		}
		if (!groupingRulesRoot) {
			return null;
		}
		if (typeof frontendApi.mountGroupingRulesSettings !== 'function') {
			return null;
		}
		groupingRulesIsland = frontendApi.mountGroupingRulesSettings({
			container: groupingRulesRoot,
			notify: createGroupingRulesNotify(),
			onSaved: function() {
				hideSettingsModal();
				updateUiWithThreadsFromServer(
					messengerGetter().info('Refreshing threads from cache...')
				).catch(reportAsyncError);
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
		if (!laterPickerRoot) {
			return null;
		}
		if (typeof frontendApi.mountLaterPickerIsland !== 'function') {
			return null;
		}
		laterPickerIsland = frontendApi.mountLaterPickerIsland({
			container: laterPickerRoot,
			notify: createLaterPickerNotify(),
			onDismiss: hideLaterPicker,
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
		if (!labelPickerRoot) {
			return null;
		}
		if (typeof frontendApi.mountLabelPickerIsland !== 'function') {
			return null;
		}
		labelPickerIsland = frontendApi.mountLabelPickerIsland({
			container: labelPickerRoot,
			notify: createLabelPickerNotify(),
			onDismiss: hideLabelPicker,
			onMoveThread: function(threadId, labelId) {
				return threadActionController.moveThreadToLabel(threadId, labelId);
			}
		});
		return {
			instance: labelPickerIsland,
			wasCreated: true
		};
	}

	function ensureThreadListIsland() {
		if (threadListIsland) {
			return {
				instance: threadListIsland,
				wasCreated: false
			};
		}
		if (!threadListRoot) {
			return null;
		}
		if (typeof frontendApi.mountThreadListIsland !== 'function') {
			return null;
		}
		threadListIsland = frontendApi.mountThreadListIsland({
			container: threadListRoot,
			onArchive: onArchiveThread,
			onDelete: onDeleteThread,
			onOpenLaterPicker: onOpenLaterPickerForThread,
			onOpenLabelPicker: onOpenLabelPickerForThread,
			onOpenThread: onOpenThread,
		});
		return {
			instance: threadListIsland,
			wasCreated: true
		};
	}

	function clearThreadList() {
		var islandState = ensureThreadListIsland();
		if (islandState) {
			islandState.instance.setGroups([]);
		}
	}

	return {
		buildLabelPickerLabels,
		clearThreadList,
		ensureGroupingRulesIsland,
		ensureLabelPickerIsland,
		ensureLaterPickerIsland,
		ensureThreadListIsland,
	};
}
