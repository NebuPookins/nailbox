import { humanizeDuration } from './display_format.js';
import type { PersonDto, ThreadMessageDto } from '../server/types/thread.js';
import type { ThreadOpenPayload } from './thread_grouping.js';
import type { Result, ThreadDataResponse } from './api.js';
import type { Messenger, MsgHandle } from './messenger_shim.js';

type RenderedMessage = ThreadMessageDto & { duration: string };

interface OpenThreadOptions extends Partial<ThreadOpenPayload> {
	threadId: string;
	setThreadId(id: string): void;
	setTitle(title: string): void;
	setSenders(people: PersonDto[]): void;
	setReceivers(people: PersonDto[]): void;
	setThreadsLoadingText(text: string): void;
	showLoading(): void;
	showModal(): void;
	getCurrentThreadId(): string | null;
	hideLoading(): void;
	clearThreads(): void;
	appendDeletedMessages(payload: { num: number; threadId: string }): void;
	appendMessage(message: RenderedMessage): void;
}

interface ReplyAllOptions {
	threadId: string | null;
	emailAddress?: string | null;
	body?: string;
	inReplyTo?: string | null;
	clearReply(): void;
	hideModal(): void;
}

interface DownloadAttachmentOptions {
	messageId: string;
	attachmentId: string;
	attachmentName: string;
	saveAttachment(blob: Blob, name: string): void;
}

interface ThreadWithModal {
	threadId: string | null;
	hideModal(): void;
}

interface ShowLaterPickerOptions {
	threadId?: string | null;
	subject?: string;
	hideModal(): void;
	openLaterPicker(threadId: string, subject: string): void;
}

interface ShowLabelPickerOptions {
	openLabelPicker(): void;
}

interface ViewOnGmailOptions {
	threadId?: string | null;
	openWindow(url: string, target: string): void;
}

interface HandleKeydownOptions {
	event: KeyboardEvent;
	hideModal(): void;
	isReplyFocused(): boolean;
	threadId: string | null;
}

interface ThreadActionController {
	deleteThread(threadId: string): Promise<{ ok: boolean; reason?: string } | undefined>;
	archiveThread(threadId: string): Promise<{ ok: boolean; reason?: string } | undefined>;
	markThreadAsSpam(threadId: string): Promise<{ ok: boolean; reason?: string } | undefined>;
}

import { type Rfc2822Payload } from './api.js';

interface AppApi {
	buildRfc2822(payload: Rfc2822Payload): Promise<Result<string>>;
	sendMessage(payload: { threadId: string; raw: string }): Promise<Result<{id?: string}>>;
	getAttachment(messageId: string, attachmentId: string): Promise<Result<{data: string}>>;
}

export function normalizeBase64AttachmentData(data: string): string {
	return data.replace(/[-_]/g, function(char) {
		return char === '-' ? '+' : '/';
	});
}

export function createBlobFromBase64Data(b64Data: string): Blob {
	var sliceSize = 512;
	var byteCharacters = atob(b64Data);
	var byteArrays = [];
	for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
		var slice = byteCharacters.slice(offset, offset + sliceSize);
		var byteNumbers = new Array(slice.length);
		for (var i = 0; i < slice.length; i++) {
			byteNumbers[i] = slice.charCodeAt(i);
		}
		byteArrays.push(new Uint8Array(byteNumbers));
	}
	return new Blob(byteArrays);
}

export function createThreadViewerController({
	appApi,
	getThreadData,
	messengerGetter,
	threadActionController,
}: {
	appApi: AppApi;
	getThreadData(threadId: string, messenger: MsgHandle): Promise<Result<ThreadDataResponse>>;
	messengerGetter(): Messenger;
	threadActionController: ThreadActionController;
}) {
	// Guards against a double-click sending the same reply twice.
	let replyInFlight = false;

	async function sendReply(options: ReplyAllOptions): Promise<Result<{ messageId: string }>> {
		var threadId = options.threadId;
		if (!threadId || !options.emailAddress) {
			return {
				ok: false,
				error: new Error('Missing thread id or authenticated email address.'),
			};
		}
		//TODO: We currently buildRfc2822 and sendMessage separately, which results in two round-trips to the server. We should consider combining these into a single API method.
		const rfcResult = await appApi.buildRfc2822({
			myEmail: options.emailAddress,
			threadId: threadId,
			body: options.body,
			inReplyTo: options.inReplyTo,
		});
		if (!rfcResult.ok) {
			return {
				ok: false,
				error: rfcResult.error,
			};
		}
		const base64EncodedEmail = rfcResult.value;
		const sendResult = await appApi.sendMessage({
			threadId: threadId,
			raw: base64EncodedEmail,
		});
		if (!sendResult.ok) {
			return {
				ok: false,
				error: sendResult.error,
			};
		}
		const resp = sendResult.value;
		options.clearReply();
		options.hideModal();
		return {
			ok: true,
			value: {
				messageId: resp.id ?? '',
			},
		};
	}

	function showError(error: unknown): void {
		messengerGetter().error(error instanceof Error ? error.message : String(error));
	}
	/**
	 * Builds a thread-viewer action that runs `action` against the currently open
	 * thread and closes the viewer only once the action reports success.
	 */
	function runCurrentThreadAction(
		action: (threadId: string) => Promise<{ ok: boolean; reason?: string } | undefined>,
		failureReason: string
	) {
		return async function(options: ThreadWithModal) {
			try {
				// The action removes the row right away, so close the modal now rather than after the
				// server responds; a failure brings the row back and is reported through the messenger.
				const pending = action(options.threadId ?? '');
				options.hideModal();
				return await pending;
			} catch (error) {
				showError(error);
				return {
					ok: false,
					reason: failureReason,
				};
			}
		};
	}
	return {
		async openThread(options: OpenThreadOptions) {
			var threadId = options.threadId;
			var actionMessenger = messengerGetter().info('Downloading thread data for ' + threadId + '...');
			options.setThreadId(threadId);
			options.setTitle(options.subject || '');
			options.setSenders(options.senders || []);
			options.setReceivers(options.receivers || []);
			options.setThreadsLoadingText(options.snippet || '');
			options.showLoading();
			options.showModal();
			function failDownload(error: unknown): void {
				const message = error instanceof Error ? error.message : String(error);
				console.error('Failed to download thread data', { threadId }, error);
				actionMessenger.update({ type: 'error', message: 'Failed to download thread data for ' + threadId + ': ' + message });
			}
			try {
				const threadDataResult = await getThreadData(threadId, actionMessenger);
				if (!threadDataResult.ok) {
					failDownload(threadDataResult.error);
					return;
				}
				var threadData = threadDataResult.value;
				if (options.getCurrentThreadId() !== threadId) {
					actionMessenger.update({ type: 'success', message: 'Downloaded thread data for ' + threadId + ' (another thread is now open).' });
					return;
				}
				options.hideLoading();
				options.clearThreads();
				var nonDeletedMessages = threadData.messages.filter(function(message) {
					return !message.deleted;
				});
				if (threadData.messages.length > nonDeletedMessages.length) {
					options.appendDeletedMessages({
						num: threadData.messages.length - nonDeletedMessages.length,
						threadId: threadId
					});
				}
				nonDeletedMessages.forEach(function(message) {
					var renderedMessage: RenderedMessage = {
						...message,
						duration: humanizeDuration(message.timeToReadSeconds ?? 0),
					};
					options.appendMessage(renderedMessage);
				});
				actionMessenger.update({ type: 'success', message: 'Successfully downloaded thread data for ' + threadId + '.' });
			} catch (error) {
				failDownload(error);
			}
		},

		// Reports progress and the outcome (including the server's error message)
		// in the status strip, so clicking Reply all always gives visible feedback.
		async replyAll(options: ReplyAllOptions): Promise<Result<{ messageId: string }>> {
			if (replyInFlight) {
				console.warn('Ignoring Reply all: a reply is already being sent', { threadId: options.threadId });
				return { ok: false, error: new Error('A reply is already being sent.') };
			}
			replyInFlight = true;
			const handle = messengerGetter().info('Sending reply...');
			try {
				const result = await sendReply(options);
				if (result.ok) {
					handle.update({ type: 'success', message: 'Reply sent.' });
				} else {
					console.error('Failed to send reply', { threadId: options.threadId, inReplyTo: options.inReplyTo }, result.error);
					handle.update({ type: 'error', message: 'Failed to send reply: ' + result.error.message });
				}
				return result;
			} catch (error) {
				console.error('Failed to send reply', { threadId: options.threadId, inReplyTo: options.inReplyTo }, error);
				const failure = error instanceof Error ? error : new Error(String(error));
				handle.update({ type: 'error', message: 'Failed to send reply: ' + failure.message });
				return { ok: false, error: failure };
			} finally {
				replyInFlight = false;
			}
		},

		async downloadAttachment(options: DownloadAttachmentOptions) {
			const result = await appApi.getAttachment(options.messageId, options.attachmentId);
			if (!result.ok) {
				showError(result.error);
				return {
					ok: false,
					reason: 'download-failed',
				};
			}
			var resp = result.value;
			options.saveAttachment(
				createBlobFromBase64Data(normalizeBase64AttachmentData(resp.data)),
				options.attachmentName
			);
		},

		deleteCurrentThread: runCurrentThreadAction(
			(threadId) => threadActionController.deleteThread(threadId),
			'delete-failed'
		),

		archiveCurrentThread: runCurrentThreadAction(
			(threadId) => threadActionController.archiveThread(threadId),
			'archive-failed'
		),

		markCurrentThreadAsSpam: runCurrentThreadAction(
			(threadId) => threadActionController.markThreadAsSpam(threadId),
			'mark-spam-failed'
		),

		showLabelPicker(options: ShowLabelPickerOptions) {
			return options.openLabelPicker();
		},

		showLaterPicker(options: ShowLaterPickerOptions) {
			if (!options.threadId) {
				messengerGetter().error('Missing thread id.');
				return false;
			}
			options.hideModal();
			return options.openLaterPicker(options.threadId, options.subject || '');
		},

		viewOnGmail(options: ViewOnGmailOptions) {
			if (options.threadId) {
				options.openWindow('https://mail.google.com/mail/u/0/#inbox/' + options.threadId, '_blank');
			}
			return false;
		},

		async handleKeydown(options: HandleKeydownOptions) {
			if (options.isReplyFocused()) {
				return;
			}
			if (options.event.key !== 'Delete') {
				return;
			}
			await this.deleteCurrentThread({
				threadId: options.threadId ?? '',
				hideModal: options.hideModal,
			});
		},
	};
}
