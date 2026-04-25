import React from 'react';
import { createRoot } from 'react-dom/client';

interface Attachment {
	filename: string;
	size: number;
	attachmentId: string;
}

interface Person {
	name: string;
	email: string;
}

interface ThreadMessage {
	messageId: string;
	from: Array<Person | null>;
	to: Person[];
	date: number;
	body: { sanitized: string };
	wordcount: number;
	duration?: string;
	attachments: Attachment[];
}

interface DeletedMessagesPayload {
	num: number;
	threadId: string;
}

interface ThreadViewerState {
	threadId: string | null;
	subject: string;
	senders: string;
	receivers: string;
	loadingText: string;
	isLoading: boolean;
	messages: ThreadMessage[];
	deletedMessages: DeletedMessagesPayload | null;
	replyText: string;
}

function pluralize(n: number, singular: string, plural: string): string {
	return n === 1 ? singular : plural;
}

function renderPeople(people: Array<Person | null> | undefined): string {
	return (people || [])
		.map(function(p) { return p && p.name ? p.name : ''; })
		.filter(Boolean)
		.join(' ');
}

function formatPrettyTimestamp(timestamp: number): string {
	const momentLib = (globalThis as Record<string, unknown>).moment as ((arg?: unknown) => { isSame: (ref: unknown, unit: string) => boolean; format: (fmt: string) => string }) | undefined;
	if (typeof momentLib !== 'function') {
		return String(timestamp || '');
	}
	const now = momentLib();
	const m = momentLib(timestamp);
	if (m.isSame(now, 'day')) return m.format('h:mm A');
	if (m.isSame(now, 'week')) return m.format('ddd h:mm A');
	if (m.isSame(now, 'year')) return m.format('MMM Do');
	return m.format('YYYY-MMM-DD');
}

function formatFilesize(size: number): string {
	const filesizeLib = (globalThis as Record<string, unknown>).filesize as ((size: number) => string) | undefined;
	if (typeof filesizeLib === 'function') {
		return filesizeLib(size);
	}
	return String(size) + ' bytes';
}

interface DeletedMessagesNoticeProps {
	num: number;
	threadId: string;
}

function DeletedMessagesNotice({ num, threadId }: DeletedMessagesNoticeProps) {
	const trashUrl = 'https://mail.google.com/mail/u/0/#trash/' + (threadId || '');
	const label = pluralize(num, 'message', 'messages');
	const pronoun = pluralize(num, 'it', 'them');
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

interface MessagePanelProps {
	message: ThreadMessage;
	onDownloadAttachment: (opts: { messageId: string; attachmentId: string; attachmentName: string }) => void;
}

function MessagePanel({ message, onDownloadAttachment }: MessagePanelProps) {
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

interface ThreadViewerAppProps {
	subject: string;
	senders: string;
	receivers: string;
	loadingText: string;
	isLoading: boolean;
	messages: ThreadMessage[];
	deletedMessages: DeletedMessagesPayload | null;
	replyText: string;
	lastMessageId: string | null;
	onReplyTextChange: (text: string) => void;
	onReplyAll: (body: string, inReplyTo: string | null) => void;
	onDownloadAttachment: (opts: { messageId: string; attachmentId: string; attachmentName: string }) => void;
	onDelete: () => void;
	onArchive: () => void;
	onOpenLaterPicker: () => void;
	onOpenLabelPicker: () => void;
	onViewOnGmail: () => void;
	onClose: () => void;
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
}: ThreadViewerAppProps) {
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

interface ThreadSummaryInput {
	threadId?: string;
	subject?: string;
	snippet?: string;
	sendersText?: string;
	receiversText?: string;
}

interface ReplyAllOpts {
	body: string;
	threadId: string | null;
	inReplyTo: string | null;
	emailAddress: string | null;
	clearReply: () => void;
	hideModal: () => void;
}

interface DeleteThreadOpts {
	threadId: string | null;
	hideModal: () => void;
}

interface ArchiveThreadOpts {
	threadId: string | null;
	hideModal: () => void;
}

interface LaterPickerOpts {
	threadId: string | null;
	subject: string;
	hideModal: () => void;
}

interface LabelPickerOpts {
	threadId: string | null;
	subject: string;
	hideThreadViewer: () => void;
}

interface ViewOnGmailOpts {
	threadId: string | null;
}

interface DownloadAttachmentOpts {
	messageId: string;
	attachmentId: string;
	attachmentName: string;
}

interface MountThreadViewerIslandDeps {
	container: Element;
	showModal: () => void;
	hideModal: () => void;
	getEmailAddress: () => string | null;
	reportError: (error: Error) => void;
	onReplyAll: (opts: ReplyAllOpts) => Promise<void>;
	onDownloadAttachment: (opts: DownloadAttachmentOpts) => Promise<void>;
	onDeleteThread: (opts: DeleteThreadOpts) => Promise<void>;
	onArchiveThread: (opts: ArchiveThreadOpts) => Promise<void>;
	onOpenLaterPicker: (opts: LaterPickerOpts) => void;
	onOpenLabelPicker: (opts: LabelPickerOpts) => void;
	onViewOnGmail: (opts: ViewOnGmailOpts) => void;
}

export interface ThreadViewerAdapter {
	appendDeletedMessages: (payload: DeletedMessagesPayload) => void;
	appendMessage: (message: ThreadMessage) => void;
	clearThreads: () => void;
	getCurrentThreadId: () => string | null;
	hideLoading: () => void;
	receiversText: string | undefined;
	sendersText: string | undefined;
	setReceivers: (text: string) => void;
	setSenders: (text: string) => void;
	setThreadId: (threadId: string) => void;
	setThreadsLoadingText: (text: string) => void;
	setTitle: (subject: string) => void;
	showLoading: () => void;
	showModal: () => void;
	snippet: string | undefined;
	subject: string | undefined;
	threadId: string | undefined;
}

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
}: MountThreadViewerIslandDeps) {
	const root = createRoot(container);

	let state: ThreadViewerState = {
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
		const lastMessageId = state.messages.length > 0
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

	function open(threadSummary: ThreadSummaryInput): ThreadViewerAdapter {
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
