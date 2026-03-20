import { filterSelectableLabels } from './thread_action_controller.js';

/**
 * Manages lazy initialization and caching of React island instances.
 *
 * @param {{
 *   frontendApi: object,
 *   $groupingRulesRoot: object,
 *   $labelPickerRoot: object,
 *   $laterPickerRoot: object,
 *   hideSettingsModal: () => void,
 *   hideLabelPicker: () => void,
 *   hideLaterPicker: () => void,
 *   threadActionController: object,
 *   getLabels: () => Array,
 *   deleteThreadFromUI: (threadId: string) => void,
 *   updateUiWithThreadsFromServer: (messenger: object) => Promise,
 *   messengerGetter: () => object,
 *   reportAsyncError: (error: Error) => void,
 * }} deps
 */
export function createIslandManager({
	frontendApi,
	$groupingRulesRoot,
	$labelPickerRoot,
	$laterPickerRoot,
	hideSettingsModal,
	hideLabelPicker,
	hideLaterPicker,
	threadActionController,
	getLabels,
	deleteThreadFromUI,
	updateUiWithThreadsFromServer,
	messengerGetter,
	reportAsyncError,
}) {
	var groupingRulesIsland = null;
	var labelPickerIsland = null;
	var laterPickerIsland = null;

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
		if (!$laterPickerRoot.length) {
			return null;
		}
		if (typeof frontendApi.mountLaterPickerIsland !== 'function') {
			return null;
		}
		laterPickerIsland = frontendApi.mountLaterPickerIsland({
			container: $laterPickerRoot.get(0),
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
		if (!$labelPickerRoot.length) {
			return null;
		}
		if (typeof frontendApi.mountLabelPickerIsland !== 'function') {
			return null;
		}
		labelPickerIsland = frontendApi.mountLabelPickerIsland({
			container: $labelPickerRoot.get(0),
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

	return {
		buildLabelPickerLabels,
		ensureGroupingRulesIsland,
		ensureLabelPickerIsland,
		ensureLaterPickerIsland,
	};
}
