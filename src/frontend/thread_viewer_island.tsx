import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ThreadMessageDto, PersonDto } from '../server/types/thread.js';
import type { ThreadOpenPayload } from './thread_grouping.js';
import { AddSenderRuleButton } from './add_sender_rule_button.js';
import { formatPerson } from './person_presenter.js';
import {
	buildEmailSrcdoc,
	buildReaderSrcdoc,
	EMAIL_FRAME_SANDBOX,
	mayReferenceRemoteContent,
	type RemoteContent,
} from './email_srcdoc.js';
import { forwardKeydownToParent, observeContentHeight } from './iframe_autosize.js';
import { linkifySegments } from './linkify.js';
import { parseWithReadability } from './readability_parser.js';
import { readerViewFor } from './reader_view.js';
import { remoteContentFor as remoteContentForMessage, senderToTrustFor } from './image_trust.js';
import { RENDER_MODES, type RenderMode, type SenderRenderModes, type TrustedImageSenders } from '../server/types/config.js';
import { renderModeFor, senderKeyOf } from './render_mode.js';

type ThreadMessage = ThreadMessageDto & { duration?: string };

interface DeletedMessagesPayload {
	num: number;
	threadId: string;
}

interface ThreadViewerState {
	threadId: string | null;
	subject: string;
	senders: PersonDto[];
	receivers: PersonDto[];
	loadingText: string;
	isLoading: boolean;
	messages: ThreadMessage[];
	deletedMessages: DeletedMessagesPayload | null;
	replyText: string;
	/** Saved render mode per sender; null until first loaded. Kept across threads. */
	senderRenderModes: SenderRenderModes | null;
	/** Modes picked for messages that have no sender to remember them by. */
	messageRenderModes: Readonly<Record<string, RenderMode>>;
	/** Senders whose remote images always load (when verified); kept across threads. */
	trustedImageSenders: TrustedImageSenders;
	/** Messages whose remote images the user chose to load. */
	remoteContentAllowedFor: ReadonlySet<string>;
}

/** The state with no thread shown, keeping only what outlives a thread. */
function emptyThreadState({ senderRenderModes, trustedImageSenders }: Pick<ThreadViewerState, 'senderRenderModes' | 'trustedImageSenders'>): ThreadViewerState {
	return {
		threadId: null,
		subject: '',
		senders: [],
		receivers: [],
		loadingText: '',
		isLoading: false,
		messages: [],
		deletedMessages: null,
		replyText: '',
		senderRenderModes,
		messageRenderModes: {},
		trustedImageSenders,
		remoteContentAllowedFor: new Set(),
	};
}

function pluralize(n: number, singular: string, plural: string): string {
	return n === 1 ? singular : plural;
}

interface PeopleListProps {
	people: Array<PersonDto | null> | undefined;
	onAddSenderRule?: (senderEmail: string) => void;
}

/** Keeps only the people there is something to show for. */
function displayablePeople(people: Array<PersonDto | null> | undefined): PersonDto[] {
	return (people || []).filter(function(person): person is PersonDto {
		return Boolean(person && (person.name || person.email));
	});
}

/**
 * Renders people as `Name (email)`, optionally with a button that turns each
 * address into an email grouping rule. People with neither a name nor an email
 * are skipped.
 */
function PeopleList({ people, onAddSenderRule }: PeopleListProps) {
	const displayable = displayablePeople(people);
	if (displayable.length === 0) {
		return null;
	}
	return (
		<>
			{displayable.map(function(person, index) {
				return (
					<span className="person" key={index}>
						{index > 0 ? ', ' : ''}
						{formatPerson(person)}
						{onAddSenderRule ? (
							<AddSenderRuleButton person={person} onAddSenderRule={onAddSenderRule} />
						) : null}
					</span>
				);
			})}
		</>
	);
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

const RENDER_MODE_LABELS: Readonly<Record<RenderMode, string>> = {
	original: 'Original',
	reader: 'Reader',
	plain: 'Plain',
};

const MIN_FRAME_HEIGHT_PX = 24;

interface SandboxedFrameProps {
	srcdoc: string;
	title: string;
}

/** Shows an HTML document in a script-less sandboxed iframe that grows to fit its content. */
function SandboxedFrame({ srcdoc, title }: SandboxedFrameProps) {
	const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
	const [loadCount, setLoadCount] = useState(0);
	const [height, setHeight] = useState(MIN_FRAME_HEIGHT_PX);
	useEffect(function() {
		if (!frame) {
			return undefined;
		}
		const stopObserving = observeContentHeight(frame, setHeight);
		const stopForwarding = forwardKeydownToParent(frame);
		return function() {
			stopObserving();
			stopForwarding();
		};
	}, [frame, loadCount]);
	return (
		<iframe
			ref={setFrame}
			title={title}
			sandbox={EMAIL_FRAME_SANDBOX}
			srcDoc={srcdoc}
			onLoad={function() { setLoadCount(function(count) { return count + 1; }); }}
			style={{ width: '100%', height: height + 'px', border: 0, display: 'block' }}
		/>
	);
}

function PlainTextBody({ text }: { text: string }) {
	return (
		<pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 'inherit', background: 'none', border: 0, padding: 0 }}>
			{linkifySegments(text).map(function(segment, index) {
				return segment.kind === 'link'
					? <a key={index} href={segment.url} target="_blank" rel="noopener noreferrer">{segment.url}</a>
					: <React.Fragment key={index}>{segment.text}</React.Fragment>;
			})}
		</pre>
	);
}

interface RemoteImagesBarProps {
	onLoadImages: () => void;
	/** Present only when the sender is verified, so "always" is never offered for a possibly forged one. */
	onAlwaysLoadImages?: () => void;
}

function RemoteImagesBar({ onLoadImages, onAlwaysLoadImages }: RemoteImagesBarProps) {
	return (
		<div className="small text-muted" style={{ padding: '2px 8px', background: '#fcf8e3' }}>
			Remote images blocked &mdash;{' '}
			<button type="button" className="btn btn-link btn-xs" style={{ padding: 0 }} onClick={onLoadImages}>
				Load images
			</button>
			{onAlwaysLoadImages !== undefined && (
				<>
					{' '}&middot;{' '}
					<button type="button" className="btn btn-link btn-xs" style={{ padding: 0 }} onClick={onAlwaysLoadImages}>
						Always load images from this sender
					</button>
				</>
			)}
		</div>
	);
}

interface MessageBodyProps {
	message: ThreadMessage;
	mode: RenderMode;
	remoteContent: RemoteContent;
	onLoadImages: () => void;
	onAlwaysLoadImages: (senderKey: string) => void;
}

function MessageBody({ message, mode, remoteContent, onLoadImages, onAlwaysLoadImages }: MessageBodyProps) {
	const html = message.body.html;
	// Memoized because the whole thread re-renders on every keystroke in the reply box.
	const frame = useMemo(function() {
		return mode === 'plain' ? null : framedBodyFor(html, mode, remoteContent);
	}, [mode, html, remoteContent]);
	const trustKey = senderToTrustFor(message);
	if (frame === null) {
		return <PlainTextBody text={message.body.plainText} />;
	}
	return (
		<>
			{frame.readerUnavailable && (
				<div className="small text-muted">Reader view unavailable for this message</div>
			)}
			{remoteContent === 'blocked' && frame.mayReferenceRemoteContent && (
				<RemoteImagesBar
					onLoadImages={onLoadImages}
					onAlwaysLoadImages={trustKey === undefined ? undefined : function() { onAlwaysLoadImages(trustKey); }}
				/>
			)}
			<SandboxedFrame srcdoc={frame.srcdoc} title={'Message from ' + formatSenderForTitle(message)} />
		</>
	);
}

interface FramedBody {
	srcdoc: string;
	mayReferenceRemoteContent: boolean;
	readerUnavailable: boolean;
}

function framedBodyFor(html: string, mode: Exclude<RenderMode, 'plain'>, remoteContent: RemoteContent): FramedBody {
	const origin = window.location.origin;
	const readerView = mode === 'reader' ? readerViewFor(html, parseWithReadability) : null;
	if (readerView !== null && readerView.kind === 'article') {
		return {
			srcdoc: buildReaderSrcdoc({ html: readerView.html, remoteContent, origin }),
			mayReferenceRemoteContent: mayReferenceRemoteContent(readerView.html),
			readerUnavailable: false,
		};
	}
	return {
		srcdoc: buildEmailSrcdoc({ html, remoteContent, origin }),
		mayReferenceRemoteContent: mayReferenceRemoteContent(html),
		readerUnavailable: readerView !== null,
	};
}

function formatSenderForTitle(message: ThreadMessage): string {
	const sender = message.from.find(function(person) { return person !== null; });
	return sender ? formatPerson(sender) : 'unknown sender';
}

interface RenderModeSwitchProps {
	mode: RenderMode;
	onChange: (mode: RenderMode) => void;
}

function RenderModeSwitch({ mode, onChange }: RenderModeSwitchProps) {
	return (
		<div className="btn-group btn-group-xs pull-right" role="group" aria-label="Render mode">
			{RENDER_MODES.map(function(candidate) {
				return (
					<button
						key={candidate}
						type="button"
						className={'btn btn-default' + (candidate === mode ? ' active' : '')}
						aria-pressed={candidate === mode}
						onClick={function() { onChange(candidate); }}
					>
						{RENDER_MODE_LABELS[candidate]}
					</button>
				);
			})}
		</div>
	);
}

interface MessagePanelProps {
	message: ThreadMessage;
	renderMode: RenderMode | null;
	remoteContent: RemoteContent;
	onAddSenderRule: (senderEmail: string) => void;
	onDownloadAttachment: (opts: { messageId: string; attachmentId: string; attachmentName: string }) => void;
	onRenderModeChange: (mode: RenderMode) => void;
	onLoadImages: () => void;
	onAlwaysLoadImages: (senderKey: string) => void;
}

function MessagePanel({ message, renderMode, remoteContent, onAddSenderRule, onDownloadAttachment, onRenderModeChange, onLoadImages, onAlwaysLoadImages }: MessagePanelProps) {
	return (
		<div className="message panel panel-default" data-message-id={message.messageId}>
			<div className="panel-heading">
				<div className="panel-title">
					<div className="row">
						<div className="col-xs-6">
							<strong>From</strong>{' '}
							<PeopleList people={message.from} onAddSenderRule={onAddSenderRule} />
							{message.senderVerification === 'unverified' && (
								<>{' '}<span className="glyphicon glyphicon-warning-sign text-warning" title="Gmail couldn't verify this sender" aria-label="Sender not verified" /></>
							)}
							{displayablePeople(message.to).length > 0
								? <>{' '}<strong>To</strong>{' '}<PeopleList people={message.to} /></>
								: null}
						</div>
						<div className="col-xs-2">{formatPrettyTimestamp(message.date)}</div>
						<div className="col-xs-4">
							{message.wordcount} words: {message.duration || ''}
							{renderMode !== null && <RenderModeSwitch mode={renderMode} onChange={onRenderModeChange} />}
						</div>
					</div>
				</div>
			</div>
			<div className="panel-body">
				<div className="row">
					<div className="col-xs-12 message-body">
						{renderMode !== null && (
							<MessageBody message={message} mode={renderMode} remoteContent={remoteContent} onLoadImages={onLoadImages} onAlwaysLoadImages={onAlwaysLoadImages} />
						)}
					</div>
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

interface ThreadIdLabelProps {
	threadId: string | null;
}

/** The thread's ID as small muted text, selectable and copied to the clipboard on click. */
function ThreadIdLabel({ threadId }: ThreadIdLabelProps) {
	if (!threadId) {
		return null;
	}
	return (
		<span
			className="thread-id"
			title="Click to copy thread ID"
			style={{ float: 'left', color: '#999', fontFamily: 'monospace', fontSize: '11px', lineHeight: '30px', cursor: 'copy', userSelect: 'text' }}
			onClick={function() {
				// Best-effort: the clipboard API is missing in insecure contexts and can reject.
				navigator.clipboard?.writeText(threadId).catch(function() {});
			}}
		>
			{threadId}
		</span>
	);
}

interface ThreadViewerAppProps {
	subject: string;
	senders: PersonDto[];
	receivers: PersonDto[];
	loadingText: string;
	isLoading: boolean;
	messages: ThreadMessage[];
	deletedMessages: DeletedMessagesPayload | null;
	replyText: string;
	lastMessageId: string | null;
	threadId: string | null;
	renderModeFor: (message: ThreadMessage) => RenderMode | null;
	remoteContentFor: (message: ThreadMessage) => RemoteContent;
	onRenderModeChange: (message: ThreadMessage, mode: RenderMode) => void;
	onLoadImages: (message: ThreadMessage) => void;
	onAlwaysLoadImages: (senderKey: string) => void;
	onAddSenderRule: (senderEmail: string) => void;
	onReplyTextChange: (text: string) => void;
	onReplyAll: (body: string, inReplyTo: string | null) => void;
	onDownloadAttachment: (opts: { messageId: string; attachmentId: string; attachmentName: string }) => void;
	onDelete: () => void;
	onArchive: () => void;
	onMarkSpam: () => void;
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
	threadId,
	renderModeFor,
	remoteContentFor,
	onRenderModeChange,
	onLoadImages,
	onAlwaysLoadImages,
	onAddSenderRule,
	onReplyTextChange,
	onReplyAll,
	onDownloadAttachment,
	onDelete,
	onArchive,
	onMarkSpam,
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
				<span className="senders">
					<PeopleList people={senders} onAddSenderRule={onAddSenderRule} />
				</span>
				{' '}
				<strong>Receivers&nbsp;</strong>
				<span className="receivers">
					<PeopleList people={receivers} />
				</span>
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
								renderMode={renderModeFor(message)}
								remoteContent={remoteContentFor(message)}
								onAddSenderRule={onAddSenderRule}
								onDownloadAttachment={onDownloadAttachment}
								onRenderModeChange={function(mode) { onRenderModeChange(message, mode); }}
								onLoadImages={function() { onLoadImages(message); }}
								onAlwaysLoadImages={onAlwaysLoadImages}
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
				<ThreadIdLabel threadId={threadId} />
				<button className="btn btn-sm btn-success archive-thread" title="Done" onClick={onArchive}>
					<span className="glyphicon glyphicon-ok"></span>
				</button>
				<button className="btn btn-sm btn-danger delete" title="Delete" onClick={onDelete}>
					<span className="glyphicon glyphicon-remove"></span>
				</button>
				<button className="btn btn-sm btn-warning later" title="Later" onClick={onOpenLaterPicker}>
					<span className="glyphicon glyphicon-time"></span>
				</button>
				<button className="btn btn-sm btn-primary label-thread" title="Label" onClick={onOpenLabelPicker}>
					<span className="glyphicon glyphicon-list"></span>
				</button>
				<button className="btn btn-sm btn-info mark-spam" title="Report spam" onClick={onMarkSpam}>
					<span className="glyphicon glyphicon-ban-circle"></span>
				</button>
				<button className="btn btn-sm btn-default view-on-gmail" title="View on Gmail" onClick={onViewOnGmail}>
					<span className="glyphicon glyphicon-option-horizontal"></span>
				</button>
				<button className="btn btn-default" type="button" onClick={onClose}>Close</button>
			</div>
		</>
	);
}

type ThreadSummaryInput = Partial<ThreadOpenPayload>;

interface ReplyAllOpts {
	body: string;
	threadId: string | null;
	inReplyTo: string | null;
	emailAddress: string | null;
	clearReply: () => void;
	hideModal: () => void;
}

/** Identifies the open thread and lets an action close the viewer when it succeeds. */
interface ThreadModalOpts {
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
	onAddSenderRule: (senderEmail: string) => void;
	onReplyAll: (opts: ReplyAllOpts) => Promise<void>;
	onDownloadAttachment: (opts: DownloadAttachmentOpts) => Promise<void>;
	onDeleteThread: (opts: ThreadModalOpts) => Promise<void>;
	onArchiveThread: (opts: ThreadModalOpts) => Promise<void>;
	onMarkThreadAsSpam: (opts: ThreadModalOpts) => Promise<void>;
	onOpenLaterPicker: (opts: LaterPickerOpts) => void;
	onOpenLabelPicker: (opts: LabelPickerOpts) => void;
	onViewOnGmail: (opts: ViewOnGmailOpts) => void;
	loadSenderRenderModes: () => Promise<SenderRenderModes>;
	saveSenderRenderMode: (senderEmail: string, mode: RenderMode) => Promise<void>;
	loadTrustedImageSenders: () => Promise<TrustedImageSenders>;
	saveTrustedImageSender: (senderEmail: string) => Promise<void>;
}

export interface ThreadViewerAdapter {
	appendDeletedMessages: (payload: DeletedMessagesPayload) => void;
	appendMessage: (message: ThreadMessage) => void;
	clearThreads: () => void;
	getCurrentThreadId: () => string | null;
	hideLoading: () => void;
	receivers: PersonDto[] | undefined;
	senders: PersonDto[] | undefined;
	setReceivers: (people: PersonDto[]) => void;
	setSenders: (people: PersonDto[]) => void;
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
	onAddSenderRule,
	onReplyAll,
	onDownloadAttachment,
	onDeleteThread,
	onArchiveThread,
	onMarkThreadAsSpam,
	onOpenLaterPicker,
	onOpenLabelPicker,
	onViewOnGmail,
	loadSenderRenderModes,
	saveSenderRenderMode,
	loadTrustedImageSenders,
	saveTrustedImageSender,
}: MountThreadViewerIslandDeps) {
	const root = createRoot(container);

	let state: ThreadViewerState = emptyThreadState({ senderRenderModes: null, trustedImageSenders: [] });

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
				threadId={state.threadId}
				renderModeFor={function(message) {
					const override = state.messageRenderModes[message.messageId];
					if (override !== undefined) {
						return override;
					}
					return state.senderRenderModes === null ? null : renderModeFor(state.senderRenderModes, message.from);
				}}
				remoteContentFor={function(message) {
					return remoteContentForMessage(state.trustedImageSenders, state.remoteContentAllowedFor, message);
				}}
				onRenderModeChange={function(message, mode) {
					const senderKey = senderKeyOf(message.from);
					if (senderKey === undefined) {
						state.messageRenderModes = { ...state.messageRenderModes, [message.messageId]: mode };
					} else {
						state.senderRenderModes = { ...state.senderRenderModes, [senderKey]: mode };
						saveSenderRenderMode(senderKey, mode).catch(reportError);
					}
					render();
				}}
				onLoadImages={function(message) {
					state.remoteContentAllowedFor = new Set([...state.remoteContentAllowedFor, message.messageId]);
					render();
				}}
				onAlwaysLoadImages={function(senderKey) {
					state.trustedImageSenders = [...state.trustedImageSenders, senderKey];
					saveTrustedImageSender(senderKey).catch(reportError);
					render();
				}}
				onAddSenderRule={onAddSenderRule}
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
				onMarkSpam={function() {
					onMarkThreadAsSpam({
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

	// Loaded once; afterwards this island's own copy is kept current. Failure just leaves images blocked.
	loadTrustedImageSenders().then(function(senders) {
		// Merged, not assigned: the user may have trusted a sender while this was loading.
		state.trustedImageSenders = [...new Set([...senders, ...state.trustedImageSenders])];
		render();
	}).catch(reportError);

	function open(threadSummary: ThreadSummaryInput): ThreadViewerAdapter {
		state = {
			...emptyThreadState(state),
			subject: threadSummary.subject || '',
			senders: threadSummary.senders || [],
			receivers: threadSummary.receivers || [],
			loadingText: threadSummary.snippet || '',
		};
		render();
		// Loaded once; afterwards this island's own copy is kept current as modes are picked.
		if (state.senderRenderModes === null) {
			loadSenderRenderModes().then(function(modes) {
				state.senderRenderModes = modes;
				render();
			}).catch(function(error: Error) {
				state.senderRenderModes = {};
				render();
				reportError(error);
			});
		}
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
			receivers: threadSummary.receivers,
			senders: threadSummary.senders,
			setReceivers: function(people) {
				state.receivers = people;
				render();
			},
			setSenders: function(people) {
				state.senders = people;
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
		state = emptyThreadState(state);
		render();
	}

	return { open, getThreadId, clear };
}
