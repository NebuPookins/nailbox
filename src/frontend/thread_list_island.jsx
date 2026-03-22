import React from 'react';
import { createRoot } from 'react-dom/client';
import {
	formatPrettyTimestamp,
	formatReadTime,
	getThreadMainDisplayedLabelIds,
	getLabelName,
} from './thread_list_presenter.js';

function renderParticipants(people) {
	return (people || []).map(function(p) {
		return p && p.name ? p.name : '';
	}).filter(Boolean).join(' ');
}

function renderPrimaryPerson(person) {
	if (!person) return '';
	var name = person.name || '';
	var email = person.email || '';
	if (!name && !email) return '';
	if (!name) return email;
	if (!email) return name;
	return name + ' (' + email + ')';
}

function renderCountSuffix(items, subtractAmount) {
	var count = Math.max((items || []).length - subtractAmount, 0);
	return count <= 0 ? '' : ' (and ' + count + ' more)';
}

function ThreadRow({ thread, labels, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread }) {
	var senders = Array.isArray(thread.senders) ? thread.senders : [];
	var receivers = Array.isArray(thread.receivers) ? thread.receivers : [];
	var mainDisplayedLabelIds = getThreadMainDisplayedLabelIds(thread);

	function handleRowClick(e) {
		if (e.target.closest('button, a, input, select, textarea, label')) {
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
					{formatPrettyTimestamp(thread.lastUpdated)}
				</div>
			</div>
			<div className="row">
				<div className="col-xs-10">
					<strong className="subject">{thread.subject || ''}</strong>
					<span>
						{mainDisplayedLabelIds.map(function(labelId) {
							return (
								<span key={labelId} className="badge">
									{getLabelName(labelId, labels)}
								</span>
							);
						})}
					</span>
					<p className="snippet">{thread.snippet || ''}</p>
				</div>
				<div className="col-xs-2">
					<small>Total:</small>
					<span className="glyphicon glyphicon-time"></span>{' '}
					{formatReadTime(thread.totalTimeToReadSeconds)}
					<br />
					<small>Recent:</small>
					<span className="glyphicon glyphicon-time"></span>{' '}
					{formatReadTime(thread.recentMessageReadTimeSeconds)}
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

function ThreadListApp({ groups, labels, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread }) {
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

export function mountThreadListIsland({ container, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread }) {
	var root = createRoot(container);
	var groups = [];
	var labels = [];

	function render() {
		root.render(
			<ThreadListApp
				groups={groups}
				labels={labels}
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
		setGroups: function(newGroups) {
			groups = newGroups;
			render();
		},
		setLabels: function(newLabels) {
			labels = newLabels;
			render();
		},
		removeThread: function(threadId) {
			groups = groups
				.map(function(group) {
					return {
						...group,
						threads: group.threads.filter(function(t) { return t.threadId !== threadId; }),
					};
				})
				.filter(function(group) { return group.threads.length > 0; });
			render();
		},
		unmount: function() {
			root.unmount();
		},
	};
}
