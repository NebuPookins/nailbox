import { AppApi, JsonValue, Result } from "./api.js";
import type { Messenger, MsgHandle, AnnouncementAction } from "./messenger_shim.js";
import type { RemovalTarget } from "./thread_list_state.js";

interface Label {
	id: string;
	type?: string;
	name?: string;
	labelListVisibility?: string;
	hue?: number;
}

export interface ActionResult {
	ok: boolean;
	reason?: string;
}

interface OpenLabelPickerOpts {
	threadId?: string | null;
	subject?: string | null;
	setTitle(s: string): void;
	setThreadId(id: string): void;
	show(): void;
}

interface SwitchToLabelPickerOpts extends OpenLabelPickerOpts {
	hideThreadViewer(): void;
}

function reportMissingThreadId(actionMessenger: MsgHandle): ActionResult {
	actionMessenger.update({ type: 'error', message: 'Missing thread id.' });
	return {
		ok: false,
		reason: 'missing-thread-id',
	};
}

function reportFailedRequest(actionMessenger: MsgHandle, error: Error): ActionResult {
	actionMessenger.update({ type: 'error', message: error.message || 'The request failed.' });
	return {
		ok: false,
		reason: 'request-failed',
	};
}

/**
 * Runs a request that is expected to resolve to a Result, converting a rejected
 * promise (a network failure never reaches the Result path) into a failed
 * Result so callers have a single failure branch to handle.
 */
async function attemptRequest(request: () => Promise<Result<JsonValue>>): Promise<Result<JsonValue>> {
	try {
		return await request();
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

function defaultSuccessMessage(verb: string, threadId: string): string {
	return `Successfully ${verb} thread ${threadId}.`;
}

export function filterSelectableLabels(labels: Label[]): Label[] {
	return labels
		.filter((label) => label.labelListVisibility !== 'labelHide')
		.filter((label) => label.id !== 'SENT' && label.id !== 'DRAFT')
		.filter((label) => (
			label.id !== 'INBOX' &&
			label.id !== 'IMPORTANT' &&
			label.id !== 'STARRED' &&
			label.id !== 'TRASH' &&
			label.id !== 'UNREAD'
		));
}

export function createThreadActionController({
	appApi,
	messengerGetter,
	withRemoval,
}: {
	appApi: AppApi
	messengerGetter: () => Messenger;
	/** Wraps a request that removes a row so the row can vanish immediately and come back if the request fails. */
	withRemoval?: (target: RemovalTarget, request: () => Promise<Result<JsonValue>>) => Promise<Result<JsonValue>>;
}) {
	async function runRemoval(
		target: RemovalTarget,
		request: () => Promise<Result<JsonValue>>,
	): Promise<Result<JsonValue>> {
		return withRemoval
			? withRemoval(target, () => attemptRequest(request))
			: attemptRequest(request);
	}

	async function runThreadAction({
		threadId,
		startMessage,
		successMessage,
		request,
		undoRequest,
		undoStartMessage,
		undoSuccessMessage,
	}: {
		threadId: string;
		startMessage: string;
		successMessage: string;
		request: () => Promise<Result<JsonValue>>;
		undoRequest?: () => Promise<Result<JsonValue>>;
		undoStartMessage?: string;
		undoSuccessMessage?: string;
	}): Promise<ActionResult> {
		const actionMessenger = messengerGetter().info(startMessage);
		if (!threadId) {
			return reportMissingThreadId(actionMessenger);
		}
		const result = await runRemoval({ kind: 'thread', threadId }, request);
		if (!result.ok) {
			return reportFailedRequest(actionMessenger, result.error);
		}
		const undoAction: AnnouncementAction | null = undoRequest ? {
			label: 'Undo',
			onClick: async () => {
				actionMessenger.update({ type: 'info', message: undoStartMessage || 'Undoing...' });
				const undoResult = await attemptRequest(undoRequest);
				if (!undoResult.ok) {
					actionMessenger.update({ type: 'error', message: undoResult.error.message || 'Undo failed.' });
				} else {
					actionMessenger.update({ type: 'success', message: undoSuccessMessage || 'Undone.' });
				}
			},
		} : null;
		actionMessenger.update({ type: 'success', message: successMessage, action: undoAction });
		return {
			ok: true,
		};
	}

	async function runBundleAction({
		bundleId,
		startMessage,
		successMessage,
		request,
		makeUndo,
	}: {
		bundleId: string;
		startMessage: string;
		successMessage: string;
		/** Must not reject; failures are reported through the Result. */
		request: () => Promise<Result<JsonValue>>;
		/** Builds the undo action from the successful result, if undo is available. */
		makeUndo?: (result: Result<JsonValue>, actionMessenger: MsgHandle) => AnnouncementAction | null;
	}): Promise<ActionResult> {
		const actionMessenger = messengerGetter().info(startMessage);
		if (!bundleId) {
			actionMessenger.update({ type: 'error', message: 'Missing bundle id.' });
			return {ok: false, reason: 'missing-bundle-id'};
		}
		const result = await request();
		if (!result.ok) {
			return reportFailedRequest(actionMessenger, result.error);
		}
		const undoAction = makeUndo ? makeUndo(result, actionMessenger) : null;
		actionMessenger.update({ type: 'success', message: successMessage, action: undoAction });
		return {ok: true};
	}

	function extractThreadIds(result: Result<JsonValue>): string[] {
		if (!result.ok) return [];
		const v = result.value as {threadIds?: unknown};
		return Array.isArray(v.threadIds) ? v.threadIds.filter((id): id is string => typeof id === 'string') : [];
	}

	async function undoThreadList(threadIds: string[], actionMessenger: MsgHandle, startMsg: string, doneMsg: string): Promise<void> {
		actionMessenger.update({ type: 'info', message: startMsg });
		for (const threadId of threadIds) {
			const r = await attemptRequest(() => appApi.unarchiveThread(threadId));
			if (!r.ok) {
				actionMessenger.update({ type: 'error', message: `Undo failed for thread ${threadId}.` });
				return;
			}
		}
		actionMessenger.update({ type: 'success', message: doneMsg });
	}

	return {
		archiveThread(threadId: string) {
			return runThreadAction({
				threadId,
				startMessage: `Archiving thread ${threadId}...`,
				successMessage: defaultSuccessMessage('archived', threadId),
				request: () => appApi.archiveThread(threadId),
				undoRequest: () => appApi.unarchiveThread(threadId),
				undoStartMessage: `Restoring thread ${threadId}...`,
				undoSuccessMessage: `Restored thread ${threadId} to inbox.`,
			});
		},
		deleteThread(threadId: string) {
			return runThreadAction({
				threadId,
				startMessage: `Deleting thread ${threadId}...`,
				successMessage: `Successfully deleted message ${threadId}`,
				request: () => appApi.deleteThread(threadId),
				undoRequest: () => appApi.untrashThread(threadId),
				undoStartMessage: `Restoring thread ${threadId}...`,
				undoSuccessMessage: `Restored thread ${threadId} to inbox.`,
			});
		},
		markThreadAsSpam(threadId: string) {
			return runThreadAction({
				threadId,
				startMessage: `Reporting thread ${threadId} as spam...`,
				successMessage: `Successfully reported thread ${threadId} as spam.`,
				request: () => appApi.markThreadAsSpam(threadId),
				undoRequest: () => appApi.unspamThread(threadId),
				undoStartMessage: `Removing spam report for thread ${threadId}...`,
				undoSuccessMessage: `Removed spam report for thread ${threadId}.`,
			});
		},
		archiveBundle(bundleId: string) {
			return runBundleAction({
				bundleId,
				startMessage: `Archiving bundle ${bundleId}...`,
				successMessage: `Successfully archived bundle.`,
				request: () => runRemoval({ kind: 'bundle', bundleId }, () => appApi.archiveBundle(bundleId)),
				makeUndo: (result, actionMessenger) => {
					const threadIds = extractThreadIds(result);
					if (threadIds.length === 0) return null;
					return {
						label: 'Undo',
						onClick: async () => {
							await undoThreadList(threadIds, actionMessenger, `Restoring ${threadIds.length} threads...`, `Restored ${threadIds.length} threads to inbox.`);
						},
					};
				},
			});
		},
		deleteBundle(bundleId: string) {
			return runBundleAction({
				bundleId,
				startMessage: `Ungrouping bundle ${bundleId}...`,
				successMessage: `Bundle ungrouped.`,
				request: () => attemptRequest(() => appApi.deleteBundle(bundleId)),
				makeUndo: (result, actionMessenger) => {
					const threadIds = extractThreadIds(result);
					if (threadIds.length === 0) return null;
					return {
						label: 'Undo',
						onClick: async () => {
							actionMessenger.update({ type: 'info', message: `Regrouping ${threadIds.length} threads...` });
							const r = await attemptRequest(() => appApi.createBundle(threadIds));
							if (!r.ok) {
								actionMessenger.update({ type: 'error', message: 'Failed to regroup bundle.' });
							} else {
								actionMessenger.update({ type: 'success', message: 'Bundle regrouped.' });
							}
						},
					};
				},
			});
		},
		moveThreadToLabel(threadId: string, labelId: string) {
			return runThreadAction({
				threadId,
				startMessage: `Moving thread ${threadId} to label...`,
				successMessage: `Successfully moved thread ${threadId} to label.`,
				request: () => appApi.moveThreadToLabel(threadId, labelId),
				undoRequest: () => appApi.unarchiveThread(threadId),
				undoStartMessage: `Moving thread ${threadId} back to inbox...`,
				undoSuccessMessage: `Moved thread ${threadId} back to inbox.`,
			});
		},
		openLabelPicker({
			threadId,
			subject,
			setTitle,
			setThreadId,
			show,
		}: OpenLabelPickerOpts): boolean {
			if (!threadId) {
				messengerGetter().error('Missing thread id.');
				return false;
			}
			setTitle(subject || '');
			setThreadId(threadId);
			show();
			return false;
		},
		switchFromThreadViewerToLabelPicker({
			threadId,
			subject,
			hideThreadViewer,
			setTitle,
			setThreadId,
			show,
		}: SwitchToLabelPickerOpts): boolean {
			if (!threadId) {
				messengerGetter().error('Missing thread id.');
				return false;
			}
			hideThreadViewer();
			setTitle(subject || '');
			setThreadId(threadId);
			show();
			return false;
		},
	};
}
