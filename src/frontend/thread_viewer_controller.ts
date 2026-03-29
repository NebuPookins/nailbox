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

interface ThreadMessage {
	messageId: string;
	deleted?: boolean;
	timeToReadSeconds?: number;
	wordcount?: number;
	[key: string]: unknown;
}

interface RenderedMessage extends ThreadMessage {
	duration: string;
}

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
	openLaterPicker(threadId: string, subject: string): unknown;
}

interface ShowLabelPickerOptions {
	openLabelPicker(): unknown;
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

interface AppApi {
	buildRfc2822(payload: Record<string, unknown>): Promise<unknown>;
	sendMessage(payload: { threadId: string; raw: string }): Promise<unknown>;
	getAttachment(messageId: string, attachmentId: string): Promise<unknown>;
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
	onError,
	onUpdateMessageWordcount,
	threadActionController,
}: {
	appApi: AppApi;
	getThreadData(threadId: string, attempt: number, messenger: MsgHandle): Promise<{ messages: ThreadMessage[] }>;
	messengerGetter(): Messenger;
	onError(error: unknown): void;
	onUpdateMessageWordcount(threadId: string, messageId: string, wordcount: number | undefined): Promise<unknown>;
	threadActionController: ThreadActionController;
}) {
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
				var threadData = await getThreadData(threadId, 0, actionMessenger);
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
					onUpdateMessageWordcount(threadId, message.messageId, message.wordcount).catch(onError);
				});
				updateMessenger(actionMessenger, 'success', 'Successfully downloaded thread data for ' + threadId + '.');
			} catch (error) {
				onError(error);
			}
		},

		async replyAll(options: ReplyAllOptions) {
			var threadId = options.threadId;
			var actionMessenger = messengerGetter().info('Sending reply to thread ' + threadId + '...');
			if (!threadId || !options.emailAddress) {
				updateMessenger(actionMessenger, 'error', 'Missing thread id or authenticated email address.');
				return {
					ok: false,
					reason: 'missing-thread-context',
				};
			}
			try {
				var base64EncodedEmail = await appApi.buildRfc2822({
					myEmail: options.emailAddress,
					threadId: threadId,
					body: options.body,
					inReplyTo: options.inReplyTo,
				});
				var resp = await appApi.sendMessage({
					threadId: threadId,
					raw: base64EncodedEmail as string
				}) as { id?: string };
				updateMessenger(actionMessenger, 'success', 'Successfully sent message with id ' + resp.id + '.');
				options.clearReply();
				options.hideModal();
				return {
					ok: true,
					messageId: resp.id,
				};
			} catch (error) {
				onError(error);
				return {
					ok: false,
					reason: 'send-failed',
				};
			}
		},

		async downloadAttachment(options: DownloadAttachmentOptions) {
			try {
				var resp = await appApi.getAttachment(options.messageId, options.attachmentId) as { data: string };
				options.saveAttachment(
					createBlobFromBase64Data(normalizeBase64AttachmentData(resp.data)),
					options.attachmentName
				);
			} catch (error) {
				onError(error);
				return {
					ok: false,
					reason: 'download-failed',
				};
			}
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
				onError(error);
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
				onError(error);
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
			return this.deleteCurrentThread({
				threadId: options.threadId ?? '',
				hideModal: options.hideModal,
			});
		},
	};
}
