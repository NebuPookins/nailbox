import { filterSelectableLabels } from './thread_action_controller.js';

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

interface LaterPickerIsland {
	open(opts: { onHideThread: (threadId: string, hideUntil: { type: string; value?: number }) => Promise<unknown>; threadId: string }): void;
	clear(): void;
}

interface LabelPickerIsland {
	open(opts: { labels?: LabelData[]; threadId?: string | null }): void;
	setLabels(labels: LabelData[]): void;
	clear(): void;
}

interface ThreadListIsland {
	setGroups(groups: unknown[]): void;
	setLabels(labels: unknown[]): void;
	removeThread(id: string): void;
}

interface IslandState<T> {
	instance: T;
	wasCreated: boolean;
}

interface GroupingRulesNotify {
	error?: (msg: string) => void;
	success?: (msg: string) => void;
}

interface FrontendApi {
	mountGroupingRulesSettings?(opts: { container: Element; notify?: GroupingRulesNotify; onSaved?: () => void }): GroupingRulesIsland;
	mountLaterPickerIsland?(opts: { container: Element; notify?: unknown; onDismiss?: () => void; onHidden?: (id: string) => void }): LaterPickerIsland;
	mountLabelPickerIsland?(opts: { container: Element; notify?: unknown; onDismiss?: () => void; onMoveThread?: (threadId: string, labelId: string) => Promise<{ ok: boolean } | undefined> }): LabelPickerIsland;
	mountThreadListIsland?(opts: {
		container: Element;
		onArchive: (id: string) => void;
		onDelete: (id: string) => void;
		onOpenLaterPicker: (summary: unknown) => void;
		onOpenLabelPicker: (summary: unknown) => void;
		onOpenThread: (summary: unknown) => void;
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
	updateUiWithThreadsFromServer(messenger: unknown): Promise<unknown>;
	messengerGetter(): Messenger;
	reportAsyncError(error: unknown): void;
	onArchiveThread(threadId: string): void;
	onDeleteThread(threadId: string): void;
	onOpenLaterPickerForThread(threadSummary: unknown): void;
	onOpenLabelPickerForThread(threadSummary: unknown): void;
	onOpenThread(threadSummary: unknown): void;
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
			}
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
