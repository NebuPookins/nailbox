import {
	renderDeletedMessagesNotice,
	renderThreadMessage,
} from './thread_viewer_presenter.js';

/**
 * Creates the openThreadViewer DOM adapter factory.
 *
 * Returns a function that, given a threadSummary, builds the adapter object
 * consumed by createThreadViewerController — keeping all $threadViewer DOM
 * access out of clientmain.js.
 *
 * @param {object} deps
 * @param {jQuery} deps.$threadViewer
 * @param {function(): string|null} deps.getThreadViewerThreadId
 * @param {function(string|null): void} deps.setThreadViewerThreadId
 * @param {function(string): void} deps.setThreadViewerSubject
 */
export function createThreadViewerAdapter({
	$threadViewer,
	getThreadViewerThreadId,
	setThreadViewerThreadId,
	setThreadViewerSubject,
}) {
	return function openThreadViewer(threadSummary) {
		var $threads = $threadViewer.find('.threads');
		return {
			appendDeletedMessages: function(payload) {
				$threads.append(renderDeletedMessagesNotice(payload));
			},
			appendMessage: function(message) {
				$threads.append(renderThreadMessage(message));
			},
			clearThreads: function() {
				$threads.empty();
			},
			getCurrentThreadId: function() {
				return getThreadViewerThreadId();
			},
			hideLoading: function() {
				$threadViewer.find('.loading-img').hide();
			},
			receiversText: threadSummary.receiversText,
			sendersText: threadSummary.sendersText,
			setReceivers: function(text) {
				$threadViewer.find('.receivers').text(text);
			},
			setSenders: function(text) {
				$threadViewer.find('.senders').text(text);
			},
			setThreadId: function(threadId) {
				setThreadViewerThreadId(threadId);
			},
			setThreadsLoadingText: function(text) {
				$threads.text(text);
			},
			setTitle: function(subject) {
				setThreadViewerSubject(subject);
				$threadViewer.find('.modal-title').text(subject);
			},
			showLoading: function() {
				$threadViewer.find('.loading-img').show();
			},
			showModal: function() {
				$threadViewer.modal('show');
			},
			snippet: threadSummary.snippet,
			subject: threadSummary.subject,
			threadId: threadSummary.threadId,
		};
	};
}
