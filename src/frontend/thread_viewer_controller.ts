declare const moment: {
	duration(amount: number, unit: string): { humanize(): string; as(unit: string): number };
};

interface MsgHandle {
	update(opts: { type: string; message: string }): void;
}

interface Messenger {
	info(message: string): MsgHandle;
	error(message: string): MsgHandle;
}

import type { ThreadMessageDto } from '../server/types/thread.js';
import type { Result, ThreadDataResponse } from './api.js';

type RenderedMessage = ThreadMessageDto & { duration: string };

interface OpenThreadOptions {
	threadId: string;
	subject?: string;
	snippet?: string;
	sendersText?: string;
	receiversText?: string;
	setThreadId(id: string): void;
	setTitle(title: string): void;
	setSenders(s: string): void;
	setReceivers(s: string): void;
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
}

import { type Rfc2822Payload } from './api.js';

interface AppApi {
	buildRfc2822(payload: Rfc2822Payload): Promise<Result<string>>;
	sendMessage(payload: { threadId: string; raw: string }): Promise<Result<{id?: string}>>;
	getAttachment(messageId: string, attachmentId: string): Promise<Result<{data: string}>>;
	updateMessageWordcount(threadId: string, messageId: string, wordcount: number): Promise<unknown>;
}

function updateMessenger(actionMessenger: MsgHandle | null | undefined, type: string, message: string): void {
	if (!actionMessenger || typeof actionMessenger.update !== 'function') {
		return;
	}
	actionMessenger.update({
		type,
		message,
	});
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
	onUpdateMessageWordcount,
	threadActionController,
}: {
	appApi: AppApi;
	getThreadData(threadId: string, attempt: number, messenger: MsgHandle): Promise<Result<ThreadDataResponse>>;
	messengerGetter(): Messenger;
	onUpdateMessageWordcount(threadId: string, messageId: string, wordcount: number | undefined): Promise<unknown>; //TODO: Check API design here.
	threadActionController: ThreadActionController;
}) {
	function showError(error: unknown): void {
		messengerGetter().error(error instanceof Error ? error.message : String(error));
	}
	return {
		async openThread(options: OpenThreadOptions) {
			var threadId = options.threadId;
			var actionMessenger = messengerGetter().info('Downloading thread data for ' + threadId + '...');
			options.setThreadId(threadId);
			options.setTitle(options.subject || '');
			options.setSenders(options.sendersText || '');
			options.setReceivers(options.receiversText || '');
			options.setThreadsLoadingText(options.snippet || '');
			options.showLoading();
			options.showModal();
			try {
				const threadDataResult = await getThreadData(threadId, 0, actionMessenger);
				if (!threadDataResult.ok) {
					showError(threadDataResult.error);
					return;
				}
				var threadData = threadDataResult.value;
				if (options.getCurrentThreadId() !== threadId) {
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
						duration: moment.duration(message.timeToReadSeconds ?? 0, 'seconds').humanize(),
					};
					options.appendMessage(renderedMessage);
					onUpdateMessageWordcount(threadId, message.messageId, message.wordcount).catch(showError);
				});
				updateMessenger(actionMessenger, 'success', 'Successfully downloaded thread data for ' + threadId + '.');
			} catch (error) {
				showError(error);
			}
		},

		async replyAll(options: ReplyAllOptions): Promise<Result<{ messageId: string }>> {
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

		async deleteCurrentThread(options: ThreadWithModal) {
			try {
				var result = await threadActionController.deleteThread(options.threadId ?? '');
				if (!result || !result.ok) {
					return result;
				}
				options.hideModal();
				return result;
			} catch (error) {
				showError(error);
				return {
					ok: false,
					reason: 'delete-failed',
				};
			}
		},

		async archiveCurrentThread(options: ThreadWithModal) {
			try {
				var result = await threadActionController.archiveThread(options.threadId ?? '');
				if (!result || !result.ok) {
					return result;
				}
				options.hideModal();
				return result;
			} catch (error) {
				showError(error);
				return {
					ok: false,
					reason: 'archive-failed',
				};
			}
		},

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
