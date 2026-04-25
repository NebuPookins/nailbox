import { filterSelectableLabels } from './thread_action_controller.js';
import type { GroupingRulesConfig, ThreadGroup } from './thread_grouping.js';
import type { HideUntilValue } from './api.js';

interface LabelData {
	id: string;
	name?: string;
	type?: string;
	labelListVisibility?: string;
	hue?: number;
}

interface MsgHandle {
	update(opts: { type: string; message: string }): void;
}

interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): void;
}

interface ThreadActionController {
	moveThreadToLabel(threadId: string, labelId: string): Promise<{ ok: boolean } | undefined>;
}

interface GroupingRulesIsland {
	refresh(): void;
}

interface Notify {
	error?: (msg: string) => void;
	success?: (msg: string) => void;
}

interface LaterPickerPayload {
	threadId: string;
	subject: string;
}

interface BundleLaterPickerPayload {
	bundleId: string;
}

interface ThreadOpenPayload {
	threadId: string;
	subject: string;
	snippet: string;
	sendersText: string;
	receiversText: string;
}

interface LaterPickerIsland {
	open(opts: { onHideThread: (threadId: string, hideUntil: HideUntilValue) => Promise<void>; threadId: string }): void;
	openForBundle(opts: { bundleId: string; onHideBundle: (bundleId: string, hideUntil: HideUntilValue) => Promise<void> }): void;
	clear(): void;
}

interface LabelPickerIsland {
	open(opts: { labels?: LabelData[]; threadId?: string | null }): void;
	openForBundle(opts: { labels?: LabelData[]; bundleId: string }): void;
	setLabels(labels: LabelData[]): void;
	clear(): void;
}

interface ThreadListIsland {
	setGroups(groups: ThreadGroup[]): void;
	setLabels(labels: LabelData[]): void;
	setGroupingRules(groupingRules: GroupingRulesConfig): void;
	removeThread(id: string): void;
	removeBundleRow(bundleId: string): void;
	createBundleRow(bundleId: string, threadIds: string[]): void;
	updateBundleRow(bundleId: string, threadIds: string[], mergeBundleIds?: string[]): void;
	ungroupBundleRow(bundleId: string): void;
}

interface IslandState<T> {
	instance: T;
	wasCreated: boolean;
}

interface FrontendApi {
	mountGroupingRulesSettings?(opts: { container: Element; notify?: Notify; onSaved?: () => void }): GroupingRulesIsland;
	mountLaterPickerIsland?(opts: { container: Element; notify?: Notify; onDismiss?: () => void; onHidden?: (id: string) => void }): LaterPickerIsland;
	mountLabelPickerIsland?(opts: { container: Element; notify?: Notify; onDismiss?: () => void; onMoveThread?: (threadId: string, labelId: string) => Promise<{ ok: boolean } | undefined>; onMoveBundle?: (bundleId: string, labelId: string) => Promise<void> }): LabelPickerIsland;
	mountThreadListIsland?(opts: {
		container: Element;
		onArchive: (id: string) => void;
		onDelete: (id: string) => void;
		onOpenLaterPicker: (payload: LaterPickerPayload) => void;
		onOpenLabelPicker: (payload: LaterPickerPayload) => void;
		onOpenThread: (payload: ThreadOpenPayload) => void;
		onCreateBundle: (threadIds: string[]) => void;
		onEditBundle: (bundleId: string, threadIds: string[], mergeBundleIds: string[]) => void;
		onArchiveBundle: (bundleId: string) => void;
		onOpenLaterPickerForBundle: (payload: BundleLaterPickerPayload) => void;
		onOpenLabelPickerForBundle: (payload: BundleLaterPickerPayload) => void;
		onUngroup: (bundleId: string) => void;
	}): ThreadListIsland;
}

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
	onCreateBundle,
	onEditBundle,
	onArchiveBundle,
	onGroupingRulesSaved,
	onOpenLaterPickerForBundle,
	onOpenLabelPickerForBundle,
	onMoveBundle,
	onUngroup,
}: {
	frontendApi: FrontendApi;
	groupingRulesRoot: Element | null;
	labelPickerRoot: Element | null;
	laterPickerRoot: Element | null;
	threadListRoot: Element | null;
	hideSettingsModal(): void;
	hideLabelPicker(): void;
	hideLaterPicker(): void;
	threadActionController: ThreadActionController;
	getLabels(): LabelData[];
	deleteThreadFromUI(threadId: string): void;
	updateUiWithThreadsFromServer(messenger: MsgHandle): Promise<void>;
	messengerGetter(): Messenger;
	reportAsyncError(error: unknown): void;
	onArchiveThread(threadId: string): void;
	onDeleteThread(threadId: string): void;
	onOpenLaterPickerForThread(payload: LaterPickerPayload): void;
	onOpenLabelPickerForThread(payload: LaterPickerPayload): void;
	onOpenThread(payload: ThreadOpenPayload): void;
	onCreateBundle(threadIds: string[]): void;
	onEditBundle(bundleId: string, threadIds: string[], mergeBundleIds: string[]): void;
	onArchiveBundle(bundleId: string): void;
	onGroupingRulesSaved?(): Promise<void>;
	onOpenLaterPickerForBundle(payload: BundleLaterPickerPayload): void;
	onOpenLabelPickerForBundle(payload: BundleLaterPickerPayload): void;
	onMoveBundle(bundleId: string, labelId: string): Promise<void>;
	onUngroup(bundleId: string): void;
}) {
	let groupingRulesIsland: GroupingRulesIsland | null = null;
	let labelPickerIsland: LabelPickerIsland | null = null;
	let laterPickerIsland: LaterPickerIsland | null = null;
	let threadListIsland: ThreadListIsland | null = null;

	function buildLabelPickerLabels(): LabelData[] {
		return filterSelectableLabels(getLabels()).map(function(label) {
			return {
				...label,
				hue: typeof label.name === 'string' ? (label.name.hashCode() % 360) : 0
			};
		});
	}

	function createGroupingRulesNotify() {
		return {
			error: function(message: string) {
				messengerGetter().error(message);
			},
			success: function(message: string) {
				messengerGetter().info(message).update({
					type: 'success',
					message: message
				});
			}
		};
	}

	function createLaterPickerNotify() {
		return {
			error: function(message: string) {
				messengerGetter().error(message);
			}
		};
	}

	function createLabelPickerNotify() {
		return {
			error: function(message: string) {
				messengerGetter().error(message);
			}
		};
	}

	function ensureGroupingRulesIsland(): IslandState<GroupingRulesIsland> | null {
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
				Promise.resolve(onGroupingRulesSaved?.()).catch(reportAsyncError);
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

	function ensureLaterPickerIsland(): IslandState<LaterPickerIsland> | null {
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

	function ensureLabelPickerIsland(): IslandState<LabelPickerIsland> | null {
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
			},
			onMoveBundle: function(bundleId, labelId) {
				return onMoveBundle(bundleId, labelId);
			},
		});
		return {
			instance: labelPickerIsland,
			wasCreated: true
		};
	}

	function ensureThreadListIsland(): IslandState<ThreadListIsland> | null {
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
			onCreateBundle: onCreateBundle,
			onEditBundle: onEditBundle,
			onArchiveBundle: onArchiveBundle,
			onOpenLaterPickerForBundle: onOpenLaterPickerForBundle,
			onOpenLabelPickerForBundle: onOpenLabelPickerForBundle,
			onUngroup: onUngroup,
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
