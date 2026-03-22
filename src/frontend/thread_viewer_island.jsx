import React from 'react';
import { createRoot } from 'react-dom/client';

function pluralize(n, singular, plural) {
	return n === 1 ? singular : plural;
}

function renderPeople(people) {
	return (people || [])
		.map(function(p) { return p && p.name ? p.name : ''; })
		.filter(Boolean)
		.join(' ');
}

function formatPrettyTimestamp(timestamp) {
	if (typeof globalThis.moment !== 'function') {
		return String(timestamp || '');
	}
	var now = globalThis.moment();
	var m = globalThis.moment(timestamp);
	if (m.isSame(now, 'day')) return m.format('h:mm A');
	if (m.isSame(now, 'week')) return m.format('ddd h:mm A');
	if (m.isSame(now, 'year')) return m.format('MMM Do');
	return m.format('YYYY-MMM-DD');
}

function formatFilesize(size) {
	if (typeof globalThis.filesize === 'function') {
		return globalThis.filesize(size);
	}
	return String(size) + ' bytes';
}

function DeletedMessagesNotice({ num, threadId }) {
	var trashUrl = 'https://mail.google.com/mail/u/0/#trash/' + (threadId || '');
	var label = pluralize(num, 'message', 'messages');
	var pronoun = pluralize(num, 'it', 'them');
	return (
		<div className="panel panel-danger">
			<div className="panel-heading">
				<div className="panel-title">{num} deleted {label}</div>
			</div>
			<div className="panel-body">
				This thread contains {num} deleted {label}.{' '}
				You can view {pronoun} at{' '}
				<a href={trashUrl} target="_blank" rel="noreferrer">{trashUrl}</a>.
			</div>
		</div>
	);
}

function MessagePanel({ message, onDownloadAttachment }) {
	return (
		<div className="message panel panel-default" data-message-id={message.messageId}>
			<div className="panel-heading">
				<div className="panel-title">
					<div className="row">
						<div className="col-xs-6">
							<strong>From</strong>{' '}{renderPeople(message.from)}
							{message.to && message.to[0] && message.to[0].name
								? <><strong>To</strong>{' '}{renderPeople(message.to)}</>
								: null}
						</div>
						<div className="col-xs-2">{formatPrettyTimestamp(message.date)}</div>
						<div className="col-xs-4">{message.wordcount} words: {message.duration || ''}</div>
					</div>
				</div>
			</div>
			<div className="panel-body">
				<div className="row">
					<div
						className="col-xs-12 message-body"
						dangerouslySetInnerHTML={{ __html: (message.body && message.body.sanitized) ? message.body.sanitized : '' }}
					/>
				</div>
			</div>
			<div className="panel-footer">
				<div className="row">
					<div className="col-xs-12 message-body">
						{(message.attachments || []).map(function(att) {
							return (
								<button
									key={att.attachmentId}
									className="btn btn-default dl-attachment"
									onClick={function() {
										onDownloadAttachment({
											messageId: message.messageId,
											attachmentId: att.attachmentId,
											attachmentName: att.filename,
										});
									}}
								>
									<span className="glyphicon glyphicon-file" aria-hidden="true"></span>
									{att.filename} {formatFilesize(att.size)}
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}

function ThreadViewerApp({
	subject,
	senders,
	receivers,
	loadingText,
	isLoading,
	messages,
	deletedMessages,
	replyText,
	lastMessageId,
	onReplyTextChange,
	onReplyAll,
	onDownloadAttachment,
	onDelete,
	onArchive,
	onOpenLaterPicker,
	onOpenLabelPicker,
	onViewOnGmail,
	onClose,
}) {
	return (
		<>
			<div className="modal-header">
				<button type="button" className="close" onClick={onClose} aria-label="Close">
					<span aria-hidden="true">&times;</span>
				</button>
				<h4 className="modal-title">{subject}</h4>
				<strong>Senders&nbsp;</strong>
				<span className="senders">{senders}</span>
				<strong>Receivers&nbsp;</strong>
				<span className="receivers">{receivers}</span>
			</div>
			<div className="modal-body">
				{isLoading && (
					<div className="loading-img">
						<img
							className="spin img-responsive center-block"
							src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Vector_Loading.svg/1024px-Vector_Loading.svg.png"
							width="100px"
							height="100px"
							alt="Loading"
						/>
					</div>
				)}
				<div className="threads">
					{!isLoading && loadingText && messages.length === 0 && !deletedMessages && (
						<div>{loadingText}</div>
					)}
					{deletedMessages && (
						<DeletedMessagesNotice num={deletedMessages.num} threadId={deletedMessages.threadId} />
					)}
					{messages.map(function(message, i) {
						return (
							<MessagePanel
								key={message.messageId || i}
								message={message}
								onDownloadAttachment={onDownloadAttachment}
							/>
						);
					})}
				</div>
				<div className="reply">
					<textarea
						rows={3}
						placeholder="Type reply here"
						className="form-control"
						value={replyText}
						onChange={function(e) { onReplyTextChange(e.target.value); }}
					/>
					<button
						className="btn btn-primary reply-all"
						onClick={function() { onReplyAll(replyText, lastMessageId); }}
					>
						Reply all
					</button>
				</div>
			</div>
			<div className="modal-footer">
				<button className="btn btn-xs btn-success archive-thread" title="Done" onClick={onArchive}>
					<span className="glyphicon glyphicon-ok"></span>
				</button>
				<button className="btn btn-xs btn-danger delete" title="Delete" onClick={onDelete}>
					<span className="glyphicon glyphicon-remove"></span>
				</button>
				<button className="btn btn-xs btn-warning later" title="Later" onClick={onOpenLaterPicker}>
					<span className="glyphicon glyphicon-time"></span>
				</button>
				<button className="btn btn-xs btn-primary label-thread" title="Label" onClick={onOpenLabelPicker}>
					<span className="glyphicon glyphicon-list"></span>
				</button>
				<button className="btn btn-xs btn-default view-on-gmail" title="View on Gmail" onClick={onViewOnGmail}>
					<span className="glyphicon glyphicon-option-horizontal"></span>
				</button>
				<button className="btn btn-default" type="button" onClick={onClose}>Close</button>
			</div>
		</>
	);
}

/**
 * Mounts the thread viewer React island into the given container.
 *
 * Returns an imperative API:
 *   open(threadSummary) → adapter — the adapter object consumed by
 *     createThreadViewerController.openThread; calling open() resets state
 *     and returns the adapter.
 *   getThreadId() → string|null — current thread id (for keydown handler).
 *   clear() — resets all state (called when the Bootstrap modal is hidden).
 *
 * @param {{
 *   container: Element,
 *   showModal: () => void,
 *   hideModal: () => void,
 *   getEmailAddress: () => string|null,
 *   reportError: (error: Error) => void,
 *   onReplyAll: (opts: object) => Promise,
 *   onDownloadAttachment: (opts: object) => Promise,
 *   onDeleteThread: (opts: object) => Promise,
 *   onArchiveThread: (opts: object) => Promise,
 *   onOpenLaterPicker: (opts: object) => void,
 *   onOpenLabelPicker: (opts: object) => void,
 *   onViewOnGmail: (opts: object) => void,
 * }} deps
 */
export function mountThreadViewerIsland({
	container,
	showModal,
	hideModal,
	getEmailAddress,
	reportError,
	onReplyAll,
	onDownloadAttachment,
	onDeleteThread,
	onArchiveThread,
	onOpenLaterPicker,
	onOpenLabelPicker,
	onViewOnGmail,
}) {
	var root = createRoot(container);

	var state = {
		threadId: null,
		subject: '',
		senders: '',
		receivers: '',
		loadingText: '',
		isLoading: false,
		messages: [],
		deletedMessages: null,
		replyText: '',
	};

	function render() {
		var lastMessageId = state.messages.length > 0
			? state.messages[state.messages.length - 1].messageId
			: null;
		root.render(
			<ThreadViewerApp
				subject={state.subject}
				senders={state.senders}
				receivers={state.receivers}
				loadingText={state.loadingText}
				isLoading={state.isLoading}
				messages={state.messages}
				deletedMessages={state.deletedMessages}
				replyText={state.replyText}
				lastMessageId={lastMessageId}
				onReplyTextChange={function(text) {
					state.replyText = text;
					render();
				}}
				onReplyAll={function(body, inReplyTo) {
					onReplyAll({
						body: body,
						threadId: state.threadId,
						inReplyTo: inReplyTo,
						emailAddress: getEmailAddress(),
						clearReply: function() {
							state.replyText = '';
							render();
						},
						hideModal: hideModal,
					}).catch(reportError);
				}}
				onDownloadAttachment={function(opts) {
					onDownloadAttachment(opts).catch(reportError);
				}}
				onDelete={function() {
					onDeleteThread({
						threadId: state.threadId,
						hideModal: hideModal,
					}).catch(reportError);
				}}
				onArchive={function() {
					onArchiveThread({
						threadId: state.threadId,
						hideModal: hideModal,
					}).catch(reportError);
				}}
				onOpenLaterPicker={function() {
					onOpenLaterPicker({
						threadId: state.threadId,
						subject: state.subject,
						hideModal: hideModal,
					});
				}}
				onOpenLabelPicker={function() {
					onOpenLabelPicker({
						threadId: state.threadId,
						subject: state.subject,
						hideThreadViewer: hideModal,
					});
				}}
				onViewOnGmail={function() {
					onViewOnGmail({ threadId: state.threadId });
				}}
				onClose={hideModal}
			/>
		);
	}

	render();

	/**
	 * Resets island state for the given thread and returns the adapter object
	 * that createThreadViewerController.openThread expects.
	 */
	function open(threadSummary) {
		state = {
			threadId: null,
			subject: threadSummary.subject || '',
			senders: threadSummary.sendersText || '',
			receivers: threadSummary.receiversText || '',
			loadingText: threadSummary.snippet || '',
			isLoading: false,
			messages: [],
			deletedMessages: null,
			replyText: '',
		};
		render();
		return {
			appendDeletedMessages: function(payload) {
				state.deletedMessages = { num: payload.num, threadId: payload.threadId };
				render();
			},
			appendMessage: function(message) {
				state.messages = state.messages.concat([message]);
				render();
			},
			clearThreads: function() {
				state.messages = [];
				state.deletedMessages = null;
				render();
			},
			getCurrentThreadId: function() {
				return state.threadId;
			},
			hideLoading: function() {
				state.isLoading = false;
				render();
			},
			receiversText: threadSummary.receiversText,
			sendersText: threadSummary.sendersText,
			setReceivers: function(text) {
				state.receivers = text;
				render();
			},
			setSenders: function(text) {
				state.senders = text;
				render();
			},
			setThreadId: function(threadId) {
				state.threadId = threadId;
				render();
			},
			setThreadsLoadingText: function(text) {
				state.loadingText = text;
				render();
			},
			setTitle: function(subject) {
				state.subject = subject;
				render();
			},
			showLoading: function() {
				state.isLoading = true;
				render();
			},
			showModal: showModal,
			snippet: threadSummary.snippet,
			subject: threadSummary.subject,
			threadId: threadSummary.threadId,
		};
	}

	function getThreadId() {
		return state.threadId;
	}

	function clear() {
		state = {
			threadId: null,
			subject: '',
			senders: '',
			receivers: '',
			loadingText: '',
			isLoading: false,
			messages: [],
			deletedMessages: null,
			replyText: '',
		};
		render();
	}

	return { open, getThreadId, clear };
}
