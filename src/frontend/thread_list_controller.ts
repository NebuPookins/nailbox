import type { BundleSummary } from './thread_grouping.js';

interface ThreadActionController {
	deleteThread(threadId: string): Promise<unknown>;
	archiveThread(threadId: string): Promise<unknown>;
	archiveBundle(bundleId: string): Promise<unknown>;
	deleteBundle(bundleId: string): Promise<unknown>;
}

interface ThreadViewerController {
	openThread(options: unknown): Promise<void>;
}

interface ThreadPayload {
	threadId: string;
	subject: string;
}

interface ThreadViewPayload {
	threadId?: string;
	subject?: string;
	snippet?: string;
	sendersText?: string;
	receiversText?: string;
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
	openLabelPicker(threadSummary: ThreadPayload): void;
	openLaterPicker(threadId: string, subject: string): void;
	openLaterPickerForBundle(bundleSummary: BundleSummary): void;
	openThreadViewer(threadSummary: ThreadViewPayload): unknown;
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
		},

		async archiveThread(threadId: string) {
			try {
				await threadActionController.archiveThread(threadId);
			} catch (error) {
				reportError(error);
			}
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

		openLabelPicker(threadSummary: ThreadPayload) {
			openLabelPicker(threadSummary);
		},

		openLaterPicker(threadSummary: ThreadPayload) {
			openLaterPicker(threadSummary.threadId, threadSummary.subject);
		},

		openLaterPickerForBundle(bundleSummary: BundleSummary) {
			openLaterPickerForBundle(bundleSummary);
		},

		async openThread(threadSummary: ThreadViewPayload) {
			try {
				await threadViewerController.openThread(openThreadViewer(threadSummary));
			} catch (error) {
				reportError(error);
			}
		},
	};
}
