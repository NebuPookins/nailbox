// @ts-nocheck
export function createThreadListController({
	openLabelPicker,
	openLaterPicker,
	openThreadViewer,
	reportError,
	threadActionController,
	threadViewerController,
}) {
	return {
		async deleteThread(threadId) {
			try {
				await threadActionController.deleteThread(threadId);
			} catch (error) {
				reportError(error);
			}
			return false;
		},

		async archiveThread(threadId) {
			try {
				await threadActionController.archiveThread(threadId);
			} catch (error) {
				reportError(error);
			}
			return false;
		},

		openLabelPicker(threadSummary) {
			return openLabelPicker(threadSummary);
		},

		openLaterPicker(threadSummary) {
			return openLaterPicker(threadSummary.threadId, threadSummary.subject);
		},

		async openThread(threadSummary) {
			try {
				await threadViewerController.openThread(openThreadViewer(threadSummary));
			} catch (error) {
				reportError(error);
			}
		},
	};
}

