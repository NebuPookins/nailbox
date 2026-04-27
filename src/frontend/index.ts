import { createAppApi, createGroupingRulesApi } from './api.js';
import type { AppApi, Result, JsonValue, HideUntilValue } from './api.js';
import { mountAuthShellIsland } from './auth_shell_island.js';
import { mountGroupingRulesIsland } from './grouping_rules_island.js';
import { mountLabelPickerIsland } from './label_picker_island.js';
import { mountLaterPickerIsland } from './later_picker_island.js';
import { mountThreadListIsland } from './thread_list_island.js';
import { mountThreadViewerIsland } from './thread_viewer_island.js';
import type { ThreadViewerAdapter } from './thread_viewer_island.js';
import type { Notify } from './island_manager.js';
import type { GroupingRulesConfig, ThreadGroup } from './thread_grouping.js';

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

interface FrontendApi {
	createAppApi(): AppApi;
	createGroupingRulesApi(): {
		loadRules(): Promise<Result<GroupingRulesConfig>>;
		saveRules(payload: JsonValue): Promise<Result<JsonValue>>;
	};
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
		api: { loadRules(): Promise<Result<GroupingRulesConfig>>; saveRules(payload: unknown): Promise<Result<unknown>> };
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
	mountThreadListIsland(opts: {
		container: Element;
		onArchive: (threadId: string) => void;
		onArchiveBundle: (bundleId: string) => void;
		onCreateBundle: (threadIds: string[]) => void;
		onDelete: (threadId: string) => void;
		onEditBundle: (bundleId: string, threadIds: string[], mergeBundleIds: string[]) => void;
		onOpenLabelPicker: (payload: { threadId: string; subject: string }) => void;
		onOpenLabelPickerForBundle: (payload: { bundleId: string }) => void;
		onOpenLaterPicker: (payload: { threadId: string; subject: string }) => void;
		onOpenLaterPickerForBundle: (payload: { bundleId: string }) => void;
		onOpenThread: (payload: { threadId: string; subject: string; snippet: string; sendersText: string; receiversText: string }) => void;
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
		onArchiveThread: (opts: { threadId: string | null; hideModal: () => void }) => Promise<void>;
		onDeleteThread: (opts: { threadId: string | null; hideModal: () => void }) => Promise<void>;
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
		open(threadSummary: { threadId?: string; subject?: string; snippet?: string; sendersText?: string; receiversText?: string }): ThreadViewerAdapter;
	};
}

const frontendApi: FrontendApi = {
	createAppApi,
	createGroupingRulesApi,
	mountAuthShellIsland,
	mountGroupingRulesIsland,
	mountGroupingRulesSettings,
	mountLabelPickerIsland,
	mountLaterPickerIsland,
	mountThreadListIsland,
	mountThreadViewerIsland,
};

export default frontendApi;
