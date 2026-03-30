interface ThreadSummary {
	threadId?: string;
	subject?: string;
	[key: string]: unknown;
}

interface BundleSummary {
	bundleId: string;
	[key: string]: unknown;
}

interface ThreadActionController {
	deleteThread(threadId: string): Promise<unknown>;
	archiveThread(threadId: string): Promise<unknown>;
	archiveBundle(bundleId: string): Promise<unknown>;
	deleteBundle(bundleId: string): Promise<unknown>;
}

interface ThreadViewerController {
	openThread(options: unknown): Promise<unknown>;
}

export function createThreadListController({
	openLabelPicker,
	openLaterPicker,
	openLaterPickerForBundle,
	openThreadViewer,
	reportError,
	threadActionController,
	threadViewerController,
}: {
	openLabelPicker(threadSummary: ThreadSummary): unknown;
	openLaterPicker(threadId: string, subject: string): unknown;
	openLaterPickerForBundle(bundleSummary: BundleSummary): unknown;
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

		async archiveBundle(bundleId: string) {
			try {
				await threadActionController.archiveBundle(bundleId);
			} catch (error) {
				reportError(error);
			}
		},

		async ungroup(bundleId: string) {
			try {
				await threadActionController.deleteBundle(bundleId);
			} catch (error) {
				reportError(error);
			}
		},

		openLabelPicker(threadSummary: ThreadSummary) {
			return openLabelPicker(threadSummary);
		},

		openLaterPicker(threadSummary: ThreadSummary) {
			return openLaterPicker(threadSummary.threadId ?? '', threadSummary.subject ?? '');
		},

		openLaterPickerForBundle(bundleSummary: BundleSummary) {
			return openLaterPickerForBundle(bundleSummary);
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
