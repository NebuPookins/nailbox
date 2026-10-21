import { AppApi, JsonValue, Result } from "./api.js";
import type { RemovalTarget } from "./thread_list_state.js";

interface Label {
	id: string;
	type?: string;
	name?: string;
	labelListVisibility?: string;
	hue?: number;
}

interface ToastAction {
	label: string;
	onClick: () => void;
}

interface MsgHandle {
	update(opts: { type: string; message: string; action?: ToastAction | null }): void;
}

interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): MsgHandle;
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

function updateMessenger(actionMessenger: MsgHandle | null, type: string, message: string, action?: ToastAction | null): void {
	if (!actionMessenger || typeof actionMessenger.update !== 'function') {
		return;
	}
	actionMessenger.update({
		type,
		message,
		action: action ?? null,
	});
}

function createActionMessenger(messengerGetter: (() => Messenger) | null | undefined, message: string): MsgHandle | null {
	if (!messengerGetter) {
		return null;
	}
	return messengerGetter().info(message);
}

function reportMissingThreadId(actionMessenger: MsgHandle | null): ActionResult {
	updateMessenger(actionMessenger, 'error', 'Missing thread id.');
	return {
		ok: false,
		reason: 'missing-thread-id',
	};
}

function reportFailedRequest(actionMessenger: MsgHandle | null, error: Error): ActionResult {
	updateMessenger(actionMessenger, 'error', error.message || 'The request failed.');
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
		const actionMessenger = createActionMessenger(messengerGetter, startMessage);
		if (!threadId) {
			return reportMissingThreadId(actionMessenger);
		}
		const result = await runRemoval({ kind: 'thread', threadId }, request);
		if (!result.ok) {
			return reportFailedRequest(actionMessenger, result.error);
		}
		const undoAction: ToastAction | null = undoRequest ? {
			label: 'Undo',
			onClick: async () => {
				updateMessenger(actionMessenger, 'info', undoStartMessage || 'Undoing...');
				const undoResult = await attemptRequest(undoRequest);
				if (!undoResult.ok) {
					updateMessenger(actionMessenger, 'error', undoResult.error.message || 'Undo failed.');
				} else {
					updateMessenger(actionMessenger, 'success', undoSuccessMessage || 'Undone.');
				}
			},
		} : null;
		updateMessenger(actionMessenger, 'success', successMessage, undoAction);
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
		makeUndo?: (result: Result<JsonValue>) => ToastAction | null;
	}): Promise<ActionResult> {
		const actionMessenger = createActionMessenger(messengerGetter, startMessage);
		if (!bundleId) {
			updateMessenger(actionMessenger, 'error', 'Missing bundle id.');
			return {ok: false, reason: 'missing-bundle-id'};
		}
		const result = await request();
		if (!result.ok) {
			return reportFailedRequest(actionMessenger, result.error);
		}
		const undoAction = makeUndo ? makeUndo(result) : null;
		updateMessenger(actionMessenger, 'success', successMessage, undoAction);
		return {ok: true};
	}

	function extractThreadIds(result: Result<JsonValue>): string[] {
		if (!result.ok) return [];
		const v = result.value as {threadIds?: unknown};
		return Array.isArray(v.threadIds) ? v.threadIds.filter((id): id is string => typeof id === 'string') : [];
	}

	async function undoThreadList(threadIds: string[], actionMessenger: MsgHandle | null, startMsg: string, doneMsg: string): Promise<void> {
		updateMessenger(actionMessenger, 'info', startMsg);
		for (const threadId of threadIds) {
			const r = await attemptRequest(() => appApi.unarchiveThread(threadId));
			if (!r.ok) {
				updateMessenger(actionMessenger, 'error', `Undo failed for thread ${threadId}.`);
				return;
			}
		}
		updateMessenger(actionMessenger, 'success', doneMsg);
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
				makeUndo: (result) => {
					const threadIds = extractThreadIds(result);
					if (threadIds.length === 0) return null;
					return {
						label: 'Undo',
						onClick: async () => {
							const m = createActionMessenger(messengerGetter, `Restoring bundle threads...`);
							await undoThreadList(threadIds, m, `Restoring ${threadIds.length} threads...`, `Restored ${threadIds.length} threads to inbox.`);
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
				makeUndo: (result) => {
					const threadIds = extractThreadIds(result);
					if (threadIds.length === 0) return null;
					return {
						label: 'Undo',
						onClick: async () => {
							const m = createActionMessenger(messengerGetter, `Regrouping bundle...`);
							updateMessenger(m, 'info', `Regrouping ${threadIds.length} threads...`);
							const r = await attemptRequest(() => appApi.createBundle(threadIds));
							if (!r.ok) {
								updateMessenger(m, 'error', 'Failed to regroup bundle.');
							} else {
								updateMessenger(m, 'success', 'Bundle regrouped.');
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
