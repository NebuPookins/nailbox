/**
 * Wires all DOM event handlers to their respective controllers and islands.
 * This is the DOM-to-controller adapter layer; all logic lives in the
 * controllers and islands passed as dependencies.
 *
 * Thread list actions (archive, delete, label, later, open) are handled by
 * the thread list React island and are no longer wired here.
 *
 * Thread viewer actions (reply, delete, archive, label, later, view-on-gmail,
 * download attachment) are handled by the thread viewer React island and are
 * no longer wired here.
 *
 * Auth controls (disconnect, refresh) are handled by the auth shell React
 * island and are no longer wired here.
 *
 * @param {{
 *   $threadViewer: object,
 *   $labelPicker: object,
 *   $laterPicker: object,
 *   $settingsBtn: object,
 *   $settingsModal: object,
 *   threadViewerController: object,
 *   islands: object,
 *   getThreadViewerThreadId: () => string|null,
 *   clearThreadViewerState: () => void,
 *   messengerGetter: () => object,
 *   reportAsyncError: (error: Error) => void,
 * }} deps
 */
export function wireModals({
	$threadViewer,
	$labelPicker,
	$laterPicker,
	$settingsBtn,
	$settingsModal,
	threadViewerController,
	islands,
	getThreadViewerThreadId,
	clearThreadViewerState,
	messengerGetter,
	reportAsyncError,
}) {
	$threadViewer.on('keydown', async function(event) {
		try {
			await threadViewerController.handleKeydown({
				event: event,
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				isReplyFocused: function() {
					return $threadViewer.find('textarea').is(':focus');
				},
				threadId: getThreadViewerThreadId()
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.on('hidden.bs.modal', function() {
		clearThreadViewerState();
	});

	$labelPicker.on('hidden.bs.modal', function() {
		var islandState = islands.ensureLabelPickerIsland();
		if (islandState && typeof islandState.instance.clear === 'function') {
			islandState.instance.clear();
		}
	});

	$laterPicker.on('hidden.bs.modal', function() {
		var islandState = islands.ensureLaterPickerIsland();
		if (islandState && typeof islandState.instance.clear === 'function') {
			islandState.instance.clear();
		}
	});

	$settingsBtn.on('click', function() {
		var islandState = islands.ensureGroupingRulesIsland();
		if (!islandState) {
			messengerGetter().error('Failed to load grouping rules editor');
			return;
		}
		if (!islandState.wasCreated) {
			islandState.instance.refresh();
		}
		$settingsModal.modal('show');
	});
}
