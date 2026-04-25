import { showModal, hideModal } from './native_modal.js';

interface MsgHandle {
	update(opts: { type: string; message: string }): void;
}

interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): MsgHandle;
}

interface ThreadViewerController {
	handleKeydown(opts: {
		event: KeyboardEvent;
		hideModal(): void;
		isReplyFocused(): boolean;
		threadId: string | null;
	}): Promise<void>;
}

interface Islands {
	ensureLabelPickerIsland(): { instance: { clear(): void } } | null;
	ensureLaterPickerIsland(): { instance: { clear(): void } } | null;
	ensureGroupingRulesIsland(): { instance: { refresh(): void }; wasCreated: boolean } | null;
}

export function wireModals({
	threadViewer,
	labelPicker,
	laterPicker,
	settingsBtn,
	settingsModal,
	threadViewerController,
	islands,
	getThreadViewerThreadId,
	clearThreadViewerState,
	messengerGetter,
	reportAsyncError,
}: {
	threadViewer: HTMLElement;
	labelPicker: HTMLElement;
	laterPicker: HTMLElement;
	settingsBtn: HTMLElement;
	settingsModal: HTMLElement;
	threadViewerController: ThreadViewerController;
	islands: Islands;
	getThreadViewerThreadId(): string | null;
	clearThreadViewerState(): void;
	messengerGetter(): Messenger;
	reportAsyncError(error: unknown): void;
}): void {
	threadViewer.addEventListener('keydown', async function(event) {
		try {
			await threadViewerController.handleKeydown({
				event: event,
				hideModal: function() {
					hideModal(threadViewer);
				},
				isReplyFocused: function() {
					return threadViewer.querySelector('textarea') === document.activeElement;
				},
				threadId: getThreadViewerThreadId()
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	threadViewer.addEventListener('hidden.bs.modal', function() {
		clearThreadViewerState();
	});

	labelPicker.addEventListener('hidden.bs.modal', function() {
		var islandState = islands.ensureLabelPickerIsland();
		if (islandState && typeof islandState.instance.clear === 'function') {
			islandState.instance.clear();
		}
	});

	laterPicker.addEventListener('hidden.bs.modal', function() {
		var islandState = islands.ensureLaterPickerIsland();
		if (islandState && typeof islandState.instance.clear === 'function') {
			islandState.instance.clear();
		}
	});

	settingsBtn.addEventListener('click', function() {
		var islandState = islands.ensureGroupingRulesIsland();
		if (!islandState) {
			messengerGetter().error('Failed to load grouping rules editor');
			return;
		}
		if (!islandState.wasCreated) {
			islandState.instance.refresh();
		}
		showModal(settingsModal);
	});

	settingsModal.querySelectorAll('[data-dismiss="modal"]').forEach(function(btn) {
		btn.addEventListener('click', function() {
			hideModal(settingsModal);
		});
	});
}
