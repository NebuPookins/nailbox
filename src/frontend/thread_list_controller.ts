interface ThreadSummary {
	threadId?: string;
	subject?: string;
	[key: string]: unknown;
}

interface ThreadActionController {
	deleteThread(threadId: string): Promise<unknown>;
	archiveThread(threadId: string): Promise<unknown>;
}

interface ThreadViewerController {
	openThread(options: unknown): Promise<unknown>;
}

export function createThreadListController({
	openLabelPicker,
	openLaterPicker,
	openThreadViewer,
	reportError,
	threadActionController,
	threadViewerController,
}: {
	openLabelPicker(threadSummary: ThreadSummary): unknown;
	openLaterPicker(threadId: string, subject: string): unknown;
	openThreadViewer(threadSummary: ThreadSummary): unknown;
	reportError(error: unknown): void;
	threadActionController: ThreadActionController;
	threadViewerController: ThreadViewerController;
}) {
	return {
		async deleteThread(threadId: string) {
			try {
				await threadActionController.deleteThread(threadId);
			} catch (error) {
				reportError(error);
			}
			return false;
		},

		async archiveThread(threadId: string) {
			try {
				await threadActionController.archiveThread(threadId);
			} catch (error) {
				reportError(error);
			}
			return false;
		},

		openLabelPicker(threadSummary: ThreadSummary) {
			return openLabelPicker(threadSummary);
		},

		openLaterPicker(threadSummary: ThreadSummary) {
			return openLaterPicker(threadSummary.threadId ?? '', threadSummary.subject ?? '');
		},

		async openThread(threadSummary: ThreadSummary) {
			try {
				await threadViewerController.openThread(openThreadViewer(threadSummary));
			} catch (error) {
				reportError(error);
			}
		},
	};
}
