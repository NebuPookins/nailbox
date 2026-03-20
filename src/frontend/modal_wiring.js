/**
 * Wires all DOM event handlers to their respective controllers and islands.
 * This is the DOM-to-controller adapter layer; all logic lives in the
 * controllers and islands passed as dependencies.
 *
 * @param {{
 *   $main: object,
 *   $authControls: object,
 *   $threadViewer: object,
 *   $labelPicker: object,
 *   $laterPicker: object,
 *   $settingsBtn: object,
 *   $settingsModal: object,
 *   appShellController: object,
 *   threadListController: object,
 *   threadViewerController: object,
 *   threadActionController: object,
 *   islands: object,
 *   getThreadViewerThreadId: () => string|null,
 *   getThreadViewerSubject: () => string|null,
 *   clearThreadViewerState: () => void,
 *   showLaterPicker: (threadId: string, subject: string) => boolean,
 *   messengerGetter: () => object,
 *   reportAsyncError: (error: Error) => void,
 *   getAuthStatus: () => object,
 * }} deps
 */
export function wireModals({
	$main,
	$authControls,
	$threadViewer,
	$labelPicker,
	$laterPicker,
	$settingsBtn,
	$settingsModal,
	appShellController,
	threadListController,
	threadViewerController,
	threadActionController,
	islands,
	getThreadViewerThreadId,
	getThreadViewerSubject,
	clearThreadViewerState,
	showLaterPicker,
	messengerGetter,
	reportAsyncError,
	getAuthStatus,
}) {
	$authControls.on('click', '#disconnect-gmail-btn', async function() {
		try {
			await appShellController.disconnectGmail();
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$authControls.on('click', '#refresh-now-btn', async function() {
		try {
			await appShellController.refreshNow();
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$main.on('click', 'button.delete', async function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		return threadListController.deleteThread($divThread.data('threadId'));
	});

	$main.on('click', 'button.archive-thread', async function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		return threadListController.archiveThread($divThread.data('threadId'));
	});

	$main.on('click', 'button.label-thread', function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		return threadListController.openLabelPicker({
			threadId: $divThread.data('threadId'),
			subject: $divThread.find('.subject').text()
		});
	});

	$main.on('click', 'button.later', function(eventObject) {
		var $divThread = $(eventObject.currentTarget).parents('.thread[data-thread-id]');
		return threadListController.openLaterPicker({
			threadId: $divThread.data('threadId'),
			subject: $divThread.find('.subject').text()
		});
	});

	$main.on('click', 'div.thread', async function(eventObject) {
		if ($(eventObject.target).closest('button, a, input, select, textarea, label').length > 0) {
			return true;
		}
		var $threadDiv = $(eventObject.currentTarget);
		await threadListController.openThread({
			receiversText: $threadDiv.find('.receivers').attr('title') || '',
			sendersText: $threadDiv.find('.senders').attr('title') || '',
			snippet: $threadDiv.find('.snippet').text(),
			subject: $threadDiv.find('.subject').text(),
			threadId: $threadDiv.data('threadId')
		});
	});

	$threadViewer.find('button.reply-all').on('click', async function() {
		try {
			await threadViewerController.replyAll({
				body: $threadViewer.find('.reply textarea').val(),
				clearReply: function() {
					$threadViewer.find('.reply textarea').val('');
				},
				emailAddress: getAuthStatus().emailAddress,
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				inReplyTo: $threadViewer.find('.threads .message:last').data('messageId'),
				threadId: getThreadViewerThreadId()
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.on('click', 'button.dl-attachment', async function(eventObj) {
		var $clickedButton = $(eventObj.currentTarget);
		try {
			await threadViewerController.downloadAttachment({
				attachmentId: $clickedButton.data('attachment-id'),
				attachmentName: $clickedButton.data('attachment-name'),
				messageId: $clickedButton.parents('.message').data('message-id'),
				saveAttachment: function(blob, attachmentName) {
					saveAs(blob, attachmentName);
				}
			});
		} catch (error) {
			reportAsyncError(error);
		}
	});

	$threadViewer.find('button.delete').on('click', async function() {
		try {
			var result = await threadViewerController.deleteCurrentThread({
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				threadId: getThreadViewerThreadId()
			});
			if (!result || !result.ok) {
				return false;
			}
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$threadViewer.find('button.archive-thread').on('click', async function() {
		try {
			var result = await threadViewerController.archiveCurrentThread({
				hideModal: function() {
					$threadViewer.modal('hide');
				},
				threadId: getThreadViewerThreadId()
			});
			if (!result || !result.ok) {
				return false;
			}
		} catch (error) {
			reportAsyncError(error);
		}
		return false;
	});

	$threadViewer.find('button.label-thread').on('click', function() {
		return threadActionController.switchFromThreadViewerToLabelPicker({
			threadId: getThreadViewerThreadId(),
			subject: getThreadViewerSubject(),
			hideThreadViewer: function() {
				$threadViewer.modal('hide');
			},
			setThreadId: function(threadId) {
				var islandState = islands.ensureLabelPickerIsland();
				if (islandState) {
					islandState.instance.open({
						labels: islands.buildLabelPickerLabels(),
						threadId: threadId
					});
				}
			},
			setTitle: function(subject) {
				$labelPicker.find('.modal-title').text(subject);
			},
			show: function() {
				$labelPicker.modal('show');
			}
		});
	});

	$threadViewer.find('button.later').on('click', function() {
		return threadViewerController.showLaterPicker({
			hideModal: function() {
				$threadViewer.modal('hide');
			},
			openLaterPicker: showLaterPicker,
			subject: getThreadViewerSubject(),
			threadId: getThreadViewerThreadId()
		});
	});

	$threadViewer.find('button.view-on-gmail').on('click', function() {
		return threadViewerController.viewOnGmail({
			openWindow: function(url, target) {
				window.open(url, target);
			},
			threadId: getThreadViewerThreadId()
		});
	});

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

	$main.on('click', 'a.view-on-gmail', function(eventObject) {
		eventObject.stopPropagation();
		return true;
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
