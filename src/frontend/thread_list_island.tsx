import React, { useState, useRef, useEffect } from 'react';
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
	type?: 'thread';
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

interface BundleSummary {
	type: 'bundle';
	bundleId: string;
	threadIds: string[];
	senders: Person[];
	lastUpdated: number;
	visibility: string;
	threadCount: number;
	memberThreads?: ThreadSummary[];
}

type ThreadRowItem = ThreadSummary | BundleSummary;

interface ThreadGroup {
	label: string;
	threads: ThreadSummary[];
	items?: ThreadRowItem[];
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

interface BundleLaterPickerPayload {
	bundleId: string;
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
	showCheckbox?: boolean;
	isSelected?: boolean;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
	onToggleSelect?: (threadId: string) => void;
}

function ThreadRow({ thread, labels, isRemoving, showCheckbox, isSelected, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread, onToggleSelect }: ThreadRowProps) {
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
	const mainDisplayedLabelIds = getThreadMainDisplayedLabelIds(thread);

	function handleRowClick(e: React.MouseEvent<HTMLDivElement>) {
		if ((e.target as Element).closest('button, a, input, select, textarea, label')) {
			return;
		}
		if (showCheckbox && onToggleSelect) {
			onToggleSelect(thread.threadId);
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
					{showCheckbox ? (
						<input
							type="checkbox"
							checked={isSelected || false}
							onChange={function() { onToggleSelect?.(thread.threadId); }}
							onClick={function(e) { e.stopPropagation(); }}
							style={{marginRight: '8px'}}
						/>
					) : null}
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
					{!showCheckbox ? (
						<React.Fragment>
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
						</React.Fragment>
					) : null}
				</div>
			</div>
		</div>
	);
}

interface BundleRowProps {
	bundle: BundleSummary;
	isExpanded: boolean;
	isRemoving: boolean;
	children?: React.ReactNode;
	onArchive: (bundleId: string) => void;
	onEdit: (bundle: BundleSummary) => void;
	onOpenLaterPicker: (payload: BundleLaterPickerPayload) => void;
	onUngroup: (bundleId: string) => void;
	onToggleExpand: (bundleId: string) => void;
}

function BundleRow({ bundle, isExpanded, isRemoving, children, onArchive, onEdit, onOpenLaterPicker, onUngroup, onToggleExpand }: BundleRowProps) {
	const rowRef = useRef<HTMLDivElement>(null);

	useEffect(function() {
		if (isRemoving && rowRef.current) {
			const el = rowRef.current;
			const height = el.offsetHeight;
			el.style.height = height + 'px';
			el.style.overflow = 'hidden';
			void el.offsetHeight;
			el.style.transition = 'height 0.4s ease-out, opacity 0.4s ease-out, margin-bottom 0.4s, border-bottom-width 0.4s';
			el.style.height = '0';
			el.style.opacity = '0';
			el.style.marginBottom = '0';
			el.style.borderBottomWidth = '0';
		}
	}, [isRemoving]);

	const senders = Array.isArray(bundle.senders) ? bundle.senders : [];

	function handleRowClick(e: React.MouseEvent<HTMLDivElement>) {
		if ((e.target as Element).closest('button, a, input, select, textarea, label')) {
			return;
		}
		onToggleExpand(bundle.bundleId);
	}

	return (
		<div
			ref={rowRef}
			className={'thread bundle visibility-' + (bundle.visibility || '')}
			data-bundle-id={bundle.bundleId}
			onClick={handleRowClick}
		>
			<div className="row">
				<div className="col-xs-10">
					<span className="glyphicon glyphicon-duplicate" title="Bundle" style={{marginRight: '6px'}}></span>
					<strong>From&nbsp;</strong>
					<span className="senders" title={senders.map((p) => renderPrimaryPerson(p)).join(', ')}>
						{renderPrimaryPerson(senders[0])}
						{senders.length > 1 ? renderCountSuffix(senders, 1) : ''}
					</span>
					<span className="badge" style={{marginLeft: '6px'}}>{bundle.threadCount} threads</span>
				</div>
				<div className="col-xs-2">
					<span className="glyphicon glyphicon-folder-open"></span>&nbsp;
					{formatPrettyTimestamp(bundle.lastUpdated)}
				</div>
			</div>
			<div className="row">
				<div className="col-xs-10">
					<em style={{color: '#888'}}>Bundle &mdash; click to {isExpanded ? 'collapse' : 'expand'}</em>
				</div>
				<div className="col-xs-2">
					<button
						className="btn btn-xs btn-success archive-thread"
						title="Archive all"
						onClick={function(e) { e.stopPropagation(); onArchive(bundle.bundleId); }}
					>
						<span className="glyphicon glyphicon-ok"></span>
					</button>
					<button
						className="btn btn-xs btn-warning later"
						title="Later"
						onClick={function(e) { e.stopPropagation(); onOpenLaterPicker({ bundleId: bundle.bundleId }); }}
					>
						<span className="glyphicon glyphicon-time"></span>
					</button>
					<button
						className="btn btn-xs btn-info"
						title="Edit bundle membership"
						onClick={function(e) { e.stopPropagation(); onEdit(bundle); }}
					>
						<span className="glyphicon glyphicon-pencil"></span>
					</button>
					<button
						className="btn btn-xs btn-default"
						title="Ungroup"
						onClick={function(e) { e.stopPropagation(); onUngroup(bundle.bundleId); }}
					>
						<span className="glyphicon glyphicon-scissors"></span>
					</button>
				</div>
			</div>
			{isExpanded && children ? (
				<div className="bundle-expanded-threads" style={{borderTop: '1px solid #ddd', marginTop: '4px'}}>
					{children}
				</div>
			) : null}
		</div>
	);
}

interface SelectionBarProps {
	selectedCount: number;
	editingBundleId: string | null;
	onBundle: () => void;
	onCancel: () => void;
}

function SelectionBar({ selectedCount, editingBundleId, onBundle, onCancel }: SelectionBarProps) {
	const isEditing = Boolean(editingBundleId);
	return (
		<div className="selection-bar" style={{padding: '8px', background: '#f5f5f5', borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: '8px'}}>
			<span>{selectedCount} selected</span>
			<button
				className="btn btn-sm btn-primary"
				disabled={selectedCount < 2}
				onClick={onBundle}
			>
				<span className="glyphicon glyphicon-duplicate"></span>
				{isEditing
					? ' Update Bundle (' + selectedCount + ')'
					: ' Bundle (' + selectedCount + ')'}
			</button>
			<button className="btn btn-sm btn-default" onClick={onCancel}>Cancel</button>
		</div>
	);
}

interface ThreadListAppProps {
	groups: ThreadGroup[];
	labels: LabelInfo[];
	removingThreadIds: Set<string>;
	removingBundleIds: Set<string>;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
	onCreateBundle: (threadIds: string[]) => void;
	onEditBundle: (bundleId: string, threadIds: string[]) => void;
	onArchiveBundle: (bundleId: string) => void;
	onOpenLaterPickerForBundle: (payload: BundleLaterPickerPayload) => void;
	onUngroup: (bundleId: string) => void;
}

function ThreadListApp({ groups, labels, removingThreadIds, removingBundleIds, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread, onCreateBundle, onEditBundle, onArchiveBundle, onOpenLaterPickerForBundle, onUngroup }: ThreadListAppProps) {
	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
	const [expandedBundleIds, setExpandedBundleIds] = useState<Set<string>>(new Set());
	const [editingBundleId, setEditingBundleId] = useState<string | null>(null);

	if (!groups || groups.length === 0) {
		return null;
	}

	// Build a set of all bundled thread IDs across all groups (for selection mode filtering)
	const bundledThreadIds = new Set<string>();
	for (const group of groups) {
		const items = group.items || group.threads.map((t) => ({...t, type: 'thread' as const}));
		for (const item of items) {
			if (item.type === 'bundle') {
				for (const tid of item.threadIds) {
					bundledThreadIds.add(tid);
				}
			}
		}
	}

	function handleToggleSelect(threadId: string) {
		const next = new Set(selectedThreadIds);
		if (next.has(threadId)) {
			next.delete(threadId);
		} else {
			next.add(threadId);
		}
		setSelectedThreadIds(next);
	}

	function handleBundle() {
		const threadIds = Array.from(selectedThreadIds);
		setSelectionMode(false);
		setSelectedThreadIds(new Set());
		setEditingBundleId(null);
		if (editingBundleId) {
			onEditBundle(editingBundleId, threadIds);
		} else {
			onCreateBundle(threadIds);
		}
	}

	function handleEditBundle(bundle: BundleSummary) {
		setExpandedBundleIds((prev) => new Set([...prev, bundle.bundleId]));
		setSelectedThreadIds(new Set(bundle.threadIds));
		setEditingBundleId(bundle.bundleId);
		setSelectionMode(true);
	}

	function handleCancelSelection() {
		setSelectionMode(false);
		setSelectedThreadIds(new Set());
		setEditingBundleId(null);
	}

	function handleToggleExpand(bundleId: string) {
		const next = new Set(expandedBundleIds);
		if (next.has(bundleId)) {
			next.delete(bundleId);
		} else {
			next.add(bundleId);
		}
		setExpandedBundleIds(next);
	}

	return (
		<React.Fragment>
			<div className="thread-list-header" style={{display: 'flex', justifyContent: 'flex-end', padding: '4px 8px'}}>
				{!selectionMode ? (
					<button
						className="btn btn-xs btn-default"
						title="Select threads to bundle"
						onClick={() => setSelectionMode(true)}
					>
						<span className="glyphicon glyphicon-check"></span> Select
					</button>
				) : null}
			</div>
			{selectionMode ? (
				<SelectionBar
					selectedCount={selectedThreadIds.size}
					editingBundleId={editingBundleId}
					onBundle={handleBundle}
					onCancel={handleCancelSelection}
				/>
			) : null}
			{groups.map(function(group, groupIdx) {
				const items: ThreadRowItem[] = group.items
					? group.items
					: group.threads.map((t) => ({...t, type: 'thread' as const}));

				return (
					<React.Fragment key={groupIdx}>
						<div className="group">{group.label || ''}</div>
						{items.map(function(item) {
							if (item.type === 'bundle') {
								const bundle = item as BundleSummary;
								const isExpanded = expandedBundleIds.has(bundle.bundleId);
								return (
									<BundleRow
										key={bundle.bundleId}
										bundle={bundle}
										isExpanded={isExpanded}
										isRemoving={removingBundleIds.has(bundle.bundleId)}
										onArchive={onArchiveBundle}
										onEdit={handleEditBundle}
										onOpenLaterPicker={onOpenLaterPickerForBundle}
										onUngroup={onUngroup}
										onToggleExpand={handleToggleExpand}
									>
										{isExpanded ? (bundle.memberThreads || []).map(function(thread) {
											const isEditingThisBundle = selectionMode && editingBundleId === bundle.bundleId;
											return (
												<ThreadRow
													key={thread.threadId}
													thread={thread}
													labels={labels}
													isRemoving={removingThreadIds.has(thread.threadId)}
													showCheckbox={isEditingThisBundle}
													isSelected={selectedThreadIds.has(thread.threadId)}
													onArchive={onArchive}
													onDelete={onDelete}
													onOpenLaterPicker={onOpenLaterPicker}
													onOpenLabelPicker={onOpenLabelPicker}
													onOpenThread={onOpenThread}
													onToggleSelect={handleToggleSelect}
												/>
											);
										}) : null}
									</BundleRow>
								);
							}

							const thread = item as ThreadSummary;
							const isBundled = bundledThreadIds.has(thread.threadId);
							return (
								<ThreadRow
									key={thread.threadId}
									thread={thread}
									labels={labels}
									isRemoving={removingThreadIds.has(thread.threadId)}
									showCheckbox={selectionMode && !isBundled}
									isSelected={selectedThreadIds.has(thread.threadId)}
									onArchive={onArchive}
									onDelete={onDelete}
									onOpenLaterPicker={onOpenLaterPicker}
									onOpenLabelPicker={onOpenLabelPicker}
									onOpenThread={onOpenThread}
									onToggleSelect={handleToggleSelect}
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
	onCreateBundle: (threadIds: string[]) => void;
	onEditBundle: (bundleId: string, threadIds: string[]) => void;
	onArchiveBundle: (bundleId: string) => void;
	onOpenLaterPickerForBundle: (payload: BundleLaterPickerPayload) => void;
	onUngroup: (bundleId: string) => void;
}

export function mountThreadListIsland({ container, onArchive, onDelete, onOpenLaterPicker, onOpenLabelPicker, onOpenThread, onCreateBundle, onEditBundle, onArchiveBundle, onOpenLaterPickerForBundle, onUngroup }: MountThreadListIslandDeps) {
	const root = createRoot(container);
	let groups: ThreadGroup[] = [];
	let labels: LabelInfo[] = [];
	let removingThreadIds = new Set<string>();
	let removingBundleIds = new Set<string>();

	function render() {
		root.render(
			<ThreadListApp
				groups={groups}
				labels={labels}
				removingThreadIds={removingThreadIds}
				removingBundleIds={removingBundleIds}
				onArchive={onArchive}
				onDelete={onDelete}
				onOpenLaterPicker={onOpenLaterPicker}
				onOpenLabelPicker={onOpenLabelPicker}
				onOpenThread={onOpenThread}
				onCreateBundle={onCreateBundle}
				onEditBundle={onEditBundle}
				onArchiveBundle={onArchiveBundle}
				onOpenLaterPickerForBundle={onOpenLaterPickerForBundle}
				onUngroup={onUngroup}
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
							items: group.items
								? group.items.filter(function(item) {
									return item.type === 'bundle' || (item as ThreadSummary).threadId !== threadId;
								})
								: undefined,
						};
					})
					.filter(function(group) {
						const items = group.items || group.threads;
						return items.length > 0;
					});
				render();
			}, REMOVE_ANIMATION_MS);
		},
		removeBundleRow: function(bundleId: string) {
			removingBundleIds = new Set(removingBundleIds);
			removingBundleIds.add(bundleId);
			render();
			setTimeout(function() {
				removingBundleIds = new Set(removingBundleIds);
				removingBundleIds.delete(bundleId);
				groups = groups
					.map(function(group) {
						return {
							...group,
							items: group.items
								? group.items.filter(function(item) {
									return item.type !== 'bundle' || (item as BundleSummary).bundleId !== bundleId;
								})
								: undefined,
						};
					})
					.filter(function(group) {
						const items = group.items || group.threads;
						return items.length > 0;
					});
				render();
			}, REMOVE_ANIMATION_MS);
		},
		unmount: function() {
			root.unmount();
		},
	};
}
