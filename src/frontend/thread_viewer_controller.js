function updateMessenger(actionMessenger, type, message) {
	if (!actionMessenger || typeof actionMessenger.update !== 'function') {
		return;
	}
	actionMessenger.update({
		type,
		message,
	});
}

export function normalizeBase64AttachmentData(data) {
	return data.replace(/[-_]/g, function(char) {
		return char === '-' ? '+' : '/';
	});
}

export function createBlobFromBase64Data(b64Data) {
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
}) {
	return {
		async openThread(options) {
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
					var renderedMessage = {
						...message,
						duration: moment.duration(message.timeToReadSeconds, 'seconds').humanize(),
					};
					options.appendMessage(renderedMessage);
					onUpdateMessageWordcount(threadId, message.messageId, message.wordcount).catch(onError);
				});
				updateMessenger(actionMessenger, 'success', 'Successfully downloaded thread data for ' + threadId + '.');
			} catch (error) {
				onError(error);
			}
		},

		async replyAll(options) {
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
					raw: base64EncodedEmail
				});
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

		async downloadAttachment(options) {
			try {
				var resp = await appApi.getAttachment(options.messageId, options.attachmentId);
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

		async deleteCurrentThread(options) {
			try {
				var result = await threadActionController.deleteThread(options.threadId);
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

		async archiveCurrentThread(options) {
			try {
				var result = await threadActionController.archiveThread(options.threadId);
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

		showLabelPicker(options) {
			return options.openLabelPicker();
		},

		showLaterPicker(options) {
			if (!options.threadId) {
				messengerGetter().error('Missing thread id.');
				return false;
			}
			options.hideModal();
			return options.openLaterPicker(options.threadId, options.subject || '');
		},

		viewOnGmail(options) {
			if (options.threadId) {
				options.openWindow('https://mail.google.com/mail/u/0/#inbox/' + options.threadId, '_blank');
			}
			return false;
		},

		async handleKeydown(options) {
			if (options.isReplyFocused()) {
				return;
			}
			if (options.event.key !== 'Delete') {
				return;
			}
			return this.deleteCurrentThread({
				threadId: options.threadId,
				hideModal: options.hideModal,
			});
		},
	};
}
