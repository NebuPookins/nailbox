import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
	formatPrettyTimestamp,
	formatReadTime,
	getThreadMainDisplayedLabelIds,
	getLabelName,
} from './thread_list_presenter.js';

interface Person {
	name: string;
	email: string;
}

interface ThreadSummary {
	threadId: string;
	senders: Person[];
	receivers: Person[];
	lastUpdated: number;
	subject: string;
	snippet: string | null;
	messageIds: string[];
	labelIds: string[];
	visibility: string;
	totalTimeToReadSeconds: number;
	recentMessageReadTimeSeconds: number;
}

interface ThreadGroup {
	label: string;
	threads: ThreadSummary[];
}

interface LabelInfo {
	id: string;
	name: string;
}

interface ThreadOpenPayload {
	threadId: string;
	subject: string;
	snippet: string;
	sendersText: string;
	receiversText: string;
}

interface LaterPickerPayload {
	threadId: string;
	subject: string;
}

function renderParticipants(people: Person[]): string {
	return (people || []).map(function(p) {
		return p && p.name ? p.name : '';
	}).filter(Boolean).join(' ');
}

function renderPrimaryPerson(person: Person | undefined): string {
	if (!person) return '';
	const name = person.name || '';
	const email = person.email || '';
	if (!name && !email) return '';
	if (!name) return email;
	if (!email) return name;
	return name + ' (' + email + ')';
}

function renderCountSuffix(items: unknown[], subtractAmount: number): string {
	const count = Math.max((items || []).length - subtractAmount, 0);
	return count <= 0 ? '' : ' (and ' + count + ' more)';
}

interface ThreadRowProps {
	thread: ThreadSummary;
	labels: LabelInfo[];
	isRemoving: boolean;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
}

function ThreadRow({ thread, labels, isRemoving, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread }: ThreadRowProps) {
	const rowRef = useRef<HTMLDivElement>(null);

	useEffect(function() {
		if (isRemoving && rowRef.current) {
			const el = rowRef.current;
			const height = el.offsetHeight;
			el.style.height = height + 'px';
			el.style.overflow = 'hidden';
			// Force reflow so the explicit height is applied before the transition starts
			void el.offsetHeight;
			el.style.transition = 'height 0.4s ease-out, opacity 0.4s ease-out, margin-bottom 0.4s, border-bottom-width 0.4s';
			el.style.height = '0';
			el.style.opacity = '0';
			el.style.marginBottom = '0';
			el.style.borderBottomWidth = '0';
		}
	}, [isRemoving]);

	const senders = Array.isArray(thread.senders) ? thread.senders : [];
	const receivers = Array.isArray(thread.receivers) ? thread.receivers : [];
	const mainDisplayedLabelIds = getThreadMainDisplayedLabelIds(thread) as string[];

	function handleRowClick(e: React.MouseEvent<HTMLDivElement>) {
		if ((e.target as Element).closest('button, a, input, select, textarea, label')) {
			return;
		}
		onOpenThread({
			threadId: thread.threadId,
			subject: thread.subject || '',
			snippet: thread.snippet || '',
			sendersText: renderParticipants(senders),
			receiversText: renderParticipants(receivers),
		});
	}

	return (
		<div
			ref={rowRef}
			className={'thread visibility-' + (thread.visibility || '')}
			data-thread-id={thread.threadId}
			onClick={handleRowClick}
		>
			<div className="row">
				<div className="col-xs-10">
					<strong>From&nbsp;</strong>
					<span className="senders" title={renderParticipants(senders)}>
						{renderPrimaryPerson(senders[0])}
						{senders.length > 1 ? renderCountSuffix(senders, 1) : ''}
					</span>
					{receivers[0] && receivers[0].name ? (
						<React.Fragment>
							<strong>To&nbsp;</strong>
							<span className="receivers" title={renderParticipants(receivers)}>
								{receivers[0].name}
								{receivers.length > 1 ? renderCountSuffix(receivers, 1) : ''}
							</span>
						</React.Fragment>
					) : null}
				</div>
				<div className="col-xs-2">
					{(thread.messageIds || []).length}
					<span className="glyphicon glyphicon-envelope"></span>&nbsp;
					{formatPrettyTimestamp(thread.lastUpdated) as string}
				</div>
			</div>
			<div className="row">
				<div className="col-xs-10">
					<strong className="subject">{thread.subject || ''}</strong>
					<span>
						{mainDisplayedLabelIds.map(function(labelId: string) {
							return (
								<span key={labelId} className="badge">
									{getLabelName(labelId, labels) as string}
								</span>
							);
						})}
					</span>
					<p className="snippet">{thread.snippet || ''}</p>
				</div>
				<div className="col-xs-2">
					<small>Total:</small>
					<span className="glyphicon glyphicon-time"></span>{' '}
					{formatReadTime(thread.totalTimeToReadSeconds) as string}
					<br />
					<small>Recent:</small>
					<span className="glyphicon glyphicon-time"></span>{' '}
					{formatReadTime(thread.recentMessageReadTimeSeconds) as string}
					<br />
					<button
						className="btn btn-xs btn-success archive-thread"
						title="Done"
						onClick={function(e) { e.stopPropagation(); onArchive(thread.threadId); }}
					>
						<span className="glyphicon glyphicon-ok"></span>
					</button>
					<button
						className="btn btn-xs btn-danger delete"
						title="Delete"
						onClick={function(e) { e.stopPropagation(); onDelete(thread.threadId); }}
					>
						<span className="glyphicon glyphicon-remove"></span>
					</button>
					<button
						className="btn btn-xs btn-warning later"
						title="Later"
						onClick={function(e) { e.stopPropagation(); onOpenLaterPicker({ threadId: thread.threadId, subject: thread.subject || '' }); }}
					>
						<span className="glyphicon glyphicon-time"></span>
					</button>
					<button
						className="btn btn-xs btn-primary label-thread"
						title="Label"
						onClick={function(e) { e.stopPropagation(); onOpenLabelPicker({ threadId: thread.threadId, subject: thread.subject || '' }); }}
					>
						<span className="glyphicon glyphicon-list"></span>
					</button>
					<a
						className="btn btn-xs btn-default view-on-gmail"
						title="View on Gmail"
						href={'https://mail.google.com/mail/u/0/#inbox/' + thread.threadId}
						target="_blank"
						rel="noreferrer"
						onClick={function(e) { e.stopPropagation(); }}
					>
						<span className="glyphicon glyphicon-option-horizontal"></span>
					</a>
				</div>
			</div>
		</div>
	);
}

interface ThreadListAppProps {
	groups: ThreadGroup[];
	labels: LabelInfo[];
	removingThreadIds: Set<string>;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
}

function ThreadListApp({ groups, labels, removingThreadIds, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread }: ThreadListAppProps) {
	if (!groups || groups.length === 0) {
		return null;
	}
	return (
		<React.Fragment>
			{groups.map(function(group, groupIdx) {
				return (
					<React.Fragment key={groupIdx}>
						<div className="group">{group.label || ''}</div>
						{(group.threads || []).map(function(thread) {
							return (
								<ThreadRow
									key={thread.threadId}
									thread={thread}
									labels={labels}
									isRemoving={removingThreadIds.has(thread.threadId)}
									onArchive={onArchive}
									onDelete={onDelete}
									onOpenLaterPicker={onOpenLaterPicker}
									onOpenLabelPicker={onOpenLabelPicker}
									onOpenThread={onOpenThread}
								/>
							);
						})}
					</React.Fragment>
				);
			})}
		</React.Fragment>
	);
}

const REMOVE_ANIMATION_MS = 400;

interface MountThreadListIslandDeps {
	container: Element;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
}

export function mountThreadListIsland({ container, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread }: MountThreadListIslandDeps) {
	const root = createRoot(container);
	let groups: ThreadGroup[] = [];
	let labels: LabelInfo[] = [];
	let removingThreadIds = new Set<string>();

	function render() {
		root.render(
			<ThreadListApp
				groups={groups}
				labels={labels}
				removingThreadIds={removingThreadIds}
				onArchive={onArchive}
				onDelete={onDelete}
				onOpenLaterPicker={onOpenLaterPicker}
				onOpenLabelPicker={onOpenLabelPicker}
				onOpenThread={onOpenThread}
			/>
		);
	}

	render();

	return {
		setGroups: function(newGroups: ThreadGroup[]) {
			groups = newGroups;
			render();
		},
		setLabels: function(newLabels: LabelInfo[]) {
			labels = newLabels;
			render();
		},
		removeThread: function(threadId: string) {
			removingThreadIds = new Set(removingThreadIds);
			removingThreadIds.add(threadId);
			render();
			setTimeout(function() {
				removingThreadIds = new Set(removingThreadIds);
				removingThreadIds.delete(threadId);
				groups = groups
					.map(function(group) {
						return {
							...group,
							threads: group.threads.filter(function(t) { return t.threadId !== threadId; }),
						};
					})
					.filter(function(group) { return group.threads.length > 0; });
				render();
			}, REMOVE_ANIMATION_MS);
		},
		unmount: function() {
			root.unmount();
		},
	};
}
