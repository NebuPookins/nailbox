interface Label {
	id: string;
	type?: string;
	name?: string;
	labelListVisibility?: string;
	hue?: number;
}

export interface MsgHandle {
	update(opts: { type: string; message: string }): void;
}

interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): MsgHandle;
}

interface AppApi {
	archiveThread(threadId: string): Promise<unknown>;
	deleteThread(threadId: string): Promise<unknown>;
	moveThreadToLabel(threadId: string, labelId: string): Promise<unknown>;
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

function updateMessenger(actionMessenger: MsgHandle | null, type: string, message: string): void {
	if (!actionMessenger || typeof actionMessenger.update !== 'function') {
		return;
	}
	actionMessenger.update({
		type,
		message,
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
	onThreadRemoved,
}: {
	appApi: AppApi;
	messengerGetter: () => Messenger;
	onThreadRemoved?: (threadId: string) => void;
}) {
	async function runThreadAction({
		threadId,
		startMessage,
		successMessage,
		request,
	}: {
		threadId: string;
		startMessage: string;
		successMessage: string;
		request: () => Promise<unknown>;
	}): Promise<ActionResult> {
		const actionMessenger = createActionMessenger(messengerGetter, startMessage);
		if (!threadId) {
			return reportMissingThreadId(actionMessenger);
		}
		await request();
		onThreadRemoved?.(threadId);
		updateMessenger(actionMessenger, 'success', successMessage);
		return {
			ok: true,
		};
	}

	return {
		archiveThread(threadId: string) {
			return runThreadAction({
				threadId,
				startMessage: `Archiving thread ${threadId}...`,
				successMessage: defaultSuccessMessage('archived', threadId),
				request: () => appApi.archiveThread(threadId),
			});
		},
		deleteThread(threadId: string) {
			return runThreadAction({
				threadId,
				startMessage: `Deleting thread ${threadId}...`,
				successMessage: `Successfully deleted message ${threadId}`,
				request: () => appApi.deleteThread(threadId),
			});
		},
		moveThreadToLabel(threadId: string, labelId: string) {
			return runThreadAction({
				threadId,
				startMessage: `Moving thread ${threadId} to label...`,
				successMessage: `Successfully moved thread ${threadId} to label.`,
				request: () => appApi.moveThreadToLabel(threadId, labelId),
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
