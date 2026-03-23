// @ts-nocheck
function updateMessenger(actionMessenger, type, message) {
	if (!actionMessenger || typeof actionMessenger.update !== 'function') {
		return;
	}
	actionMessenger.update({
		type,
		message,
	});
}

function createActionMessenger(messengerGetter, message) {
	if (!messengerGetter) {
		return null;
	}
	return messengerGetter().info(message);
}

function reportMissingThreadId(actionMessenger) {
	updateMessenger(actionMessenger, 'error', 'Missing thread id.');
	return {
		ok: false,
		reason: 'missing-thread-id',
	};
}

function defaultSuccessMessage(verb, threadId) {
	return `Successfully ${verb} thread ${threadId}.`;
}

export function filterSelectableLabels(labels) {
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
}) {
	async function runThreadAction({
		threadId,
		startMessage,
		successMessage,
		request,
	}) {
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
		archiveThread(threadId) {
			return runThreadAction({
				threadId,
				startMessage: `Archiving thread ${threadId}...`,
				successMessage: defaultSuccessMessage('archived', threadId),
				request: () => appApi.archiveThread(threadId),
			});
		},
		deleteThread(threadId) {
			return runThreadAction({
				threadId,
				startMessage: `Deleting thread ${threadId}...`,
				successMessage: `Successfully deleted message ${threadId}`,
				request: () => appApi.deleteThread(threadId),
			});
		},
		moveThreadToLabel(threadId, labelId) {
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
		}) {
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
		}) {
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
