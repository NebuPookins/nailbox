import { createAppApi, createGroupingRulesApi } from './api.js';
import type { AppApi, GroupingRulesApi, HideUntilValue } from './api.js';
import { mountAuthShellIsland } from './auth_shell_island.js';
import { mountGroupingRulesIsland } from './grouping_rules_island.js';
import { mountGroupingRulesDebugIsland } from './grouping_rules_debug_island.js';
import { mountLabelPickerIsland } from './label_picker_island.js';
import { mountLaterPickerIsland } from './later_picker_island.js';
import { mountSenderRuleIsland, type SenderRuleIsland } from './sender_rule_island.js';
import { mountThreadListIsland } from './thread_list_island.js';
import { mountThreadViewerIsland } from './thread_viewer_island.js';
import type { ThreadViewerAdapter } from './thread_viewer_island.js';
import type { Notify } from './island_manager.js';
import type { GroupingRulesConfig, ThreadGroup, ThreadOpenPayload, ThreadRowItem } from './thread_grouping.js';
import type { GroupingRulesDebugIsland } from './grouping_rules_debug_island.js';

export function mountGroupingRulesSettings({ container, onSaved }: {
	container: Element;
	onSaved?: () => void;
}) {
	return mountGroupingRulesIsland({
		container,
		api: createGroupingRulesApi(),
		onSaved,
	});
}

export function mountSenderRulePicker({ container, showModal, hideModal, onSaved }: {
	container: Element;
	showModal: () => void;
	hideModal: () => void;
	onSaved: () => void;
}): SenderRuleIsland {
	return mountSenderRuleIsland({
		api: createGroupingRulesApi(),
		container,
		showModal,
		hideModal,
		onSaved,
	});
}

interface FrontendApi {
	createAppApi(): AppApi;
	createGroupingRulesApi(): GroupingRulesApi;
	mountAuthShellIsland(opts: {
		statusContainer: Element;
		authControlsContainer: Element;
		onDisconnect: () => void;
		onRefreshNow: () => void;
	}): {
		setConnectedLoading(opts?: { emailAddress?: string | null }): void;
		setDisconnected(message?: string | null): void;
		setEmpty(): void;
		setError(): void;
		setIdle(): void;
		setSetupNeeded(message?: string | null): void;
	};
	mountGroupingRulesIsland(opts: {
		api: GroupingRulesApi;
		container: Element;
		onSaved?: () => void;
	}): {
		refresh(): void;
		unmount(): void;
	};
	mountGroupingRulesSettings(opts: {
		container: Element;
		onSaved?: () => void;
	}): {
		refresh(): void;
		unmount(): void;
	};
	mountLabelPickerIsland(opts: {
		container: Element;
		notify?: Notify;
		onDismiss?: () => void;
		onMoveThread?: (threadId: string, labelId: string) => Promise<{ ok: boolean } | undefined>;
		onMoveBundle?: (bundleId: string, labelId: string) => Promise<void>;
	}): {
		clear(): void;
		open(opts: { labels?: Array<{ id: string; name: string; type: 'system' | 'user'; hue?: number }>; threadId?: string | null }): void;
		openForBundle(opts: { labels?: Array<{ id: string; name: string; type: 'system' | 'user'; hue?: number }>; bundleId: string }): void;
		setLabels(labels: Array<{ id: string; name: string; type: 'system' | 'user'; hue?: number }>): void;
		unmount(): void;
	};
	mountLaterPickerIsland(opts: {
		container: Element;
		notify?: Notify;
		onDismiss?: () => void;
		onHidden?: (threadId: string) => void;
	}): {
		clear(): void;
		open(opts: { onHideThread: (threadId: string, hideUntil: HideUntilValue) => Promise<void>; threadId: string }): void;
		openForBundle(opts: { bundleId: string; onHideBundle: (bundleId: string, hideUntil: HideUntilValue) => Promise<void> }): void;
		unmount(): void;
	};
	mountGroupingRulesDebugIsland(opts: {
		container: Element;
		showModal: () => void;
		hideModal: () => void;
	}): GroupingRulesDebugIsland;
	mountSenderRulePicker(opts: {
		container: Element;
		showModal: () => void;
		hideModal: () => void;
		onSaved: () => void;
	}): SenderRuleIsland;
	mountThreadListIsland(opts: {
		container: Element;
		onAddSenderRule: (senderEmail: string) => void;
		onArchive: (threadId: string) => void;
		onArchiveBundle: (bundleId: string) => void;
		onCreateBundle: (threadIds: string[]) => void;
		onDebugGrouping: (item: ThreadRowItem) => void;
		onDelete: (threadId: string) => void;
		onEditBundle: (bundleId: string, threadIds: string[], mergeBundleIds: string[]) => void;
		onMarkSpam: (threadId: string) => void;
		onOpenLabelPicker: (payload: { threadId: string; subject: string }) => void;
		onOpenLabelPickerForBundle: (payload: { bundleId: string }) => void;
		onOpenLaterPicker: (payload: { threadId: string; subject: string }) => void;
		onOpenLaterPickerForBundle: (payload: { bundleId: string }) => void;
		onOpenThread: (payload: ThreadOpenPayload) => void;
		onUngroup: (bundleId: string) => void;
	}): {
		createBundleRow(bundleId: string, threadIds: string[]): void;
		removeBundleRow(bundleId: string): void;
		removeThread(id: string): void;
		setGroupingRules(rules: GroupingRulesConfig): void;
		setGroups(groups: ThreadGroup[]): void;
		setLabels(labels: Array<{ id: string; name: string }>): void;
		ungroupBundleRow(bundleId: string): void;
		updateBundleRow(bundleId: string, threadIds: string[], mergeBundleIds?: string[]): void;
	};
	mountThreadViewerIsland(opts: {
		container: Element;
		getEmailAddress: () => string | null;
		hideModal: () => void;
		onAddSenderRule: (senderEmail: string) => void;
		onArchiveThread: (opts: { threadId: string | null; hideModal: () => void }) => Promise<void>;
		onDeleteThread: (opts: { threadId: string | null; hideModal: () => void }) => Promise<void>;
		onMarkThreadAsSpam: (opts: { threadId: string | null; hideModal: () => void }) => Promise<void>;
		onDownloadAttachment: (opts: { messageId: string; attachmentId: string; attachmentName: string }) => Promise<void>;
		onOpenLabelPicker: (opts: { threadId: string | null; subject: string; hideThreadViewer: () => void }) => void;
		onOpenLaterPicker: (opts: { threadId: string | null; subject: string; hideModal: () => void }) => void;
		onReplyAll: (opts: { body: string; threadId: string | null; inReplyTo: string | null; emailAddress: string | null; clearReply: () => void; hideModal: () => void }) => Promise<void>;
		onViewOnGmail: (opts: { threadId: string | null }) => void;
		reportError: (error: Error) => void;
		showModal: () => void;
	}): {
		clear(): void;
		getThreadId(): string | null;
		open(threadSummary: Partial<ThreadOpenPayload>): ThreadViewerAdapter;
	};
}

const frontendApi: FrontendApi = {
	createAppApi,
	createGroupingRulesApi,
	mountAuthShellIsland,
	mountGroupingRulesDebugIsland,
	mountGroupingRulesIsland,
	mountGroupingRulesSettings,
	mountLabelPickerIsland,
	mountLaterPickerIsland,
	mountSenderRulePicker,
	mountThreadListIsland,
	mountThreadViewerIsland,
};

export default frontendApi;
