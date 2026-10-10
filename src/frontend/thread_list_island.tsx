import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
	formatPrettyTimestamp,
	formatReadTime,
	getThreadMainDisplayedLabelIds,
	getLabelName,
} from './thread_list_presenter.js';
import { AddSenderRuleButton } from './add_sender_rule_button.js';
import { formatPerson } from './person_presenter.js';
import { goneItems, groupsWithAnimatingRows, itemKey, type AnimatingRow } from './animating_rows.js';
import {
	type BundleSummary,
	type ThreadGroup,
	type ThreadOpenPayload,
	type ThreadRowItem,
	type ThreadSummary,
} from './thread_grouping.js';

interface Person {
	name: string;
	email: string;
}

interface LabelInfo {
	id: string;
	name: string;
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

function renderCountSuffix(items: unknown[], subtractAmount: number): string {
	const count = Math.max((items || []).length - subtractAmount, 0);
	return count <= 0 ? '' : ' (and ' + count + ' more)';
}

interface SenderSummaryProps {
	senders: Person[];
	title: string;
	onAddSenderRule: (senderEmail: string) => void;
}

/** Shows the first sender, how many others there are, and the grouping-rule button. */
function SenderSummary({ senders, title, onAddSenderRule }: SenderSummaryProps) {
	return (
		<React.Fragment>
			<span className="senders" title={title}>
				{formatPerson(senders[0])}
				{senders.length > 1 ? renderCountSuffix(senders, 1) : ''}
			</span>
			<AddSenderRuleButton person={senders[0]} onAddSenderRule={onAddSenderRule} />
		</React.Fragment>
	);
}

interface ThreadRowProps {
	thread: ThreadSummary;
	labels: LabelInfo[];
	isRemoving: boolean;
	showCheckbox?: boolean;
	isSelected?: boolean;
	onAddSenderRule: (senderEmail: string) => void;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onMarkSpam: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
	onToggleSelect?: (threadId: string) => void;
	onDebugGrouping: (item: ThreadRowItem) => void;
}

/**
 * Collapses the row while it animates out. Clears the inline styles if the row stops
 * being removed (e.g. the removal failed), so it shows again.
 */
function useCollapseWhileRemoving(rowRef: React.RefObject<HTMLDivElement | null>, isRemoving: boolean): void {
	useEffect(function() {
		const el = rowRef.current;
		if (!isRemoving || !el) {
			return;
		}
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
		return function() {
			el.style.removeProperty('height');
			el.style.removeProperty('overflow');
			el.style.removeProperty('transition');
			el.style.removeProperty('opacity');
			el.style.removeProperty('margin-bottom');
			el.style.removeProperty('border-bottom-width');
		};
	}, [isRemoving]);
}

function ThreadRow({ thread, labels, isRemoving, showCheckbox, isSelected, onAddSenderRule, onArchive, onDelete, onMarkSpam, onOpenLaterPicker, onOpenLabelPicker, onOpenThread, onToggleSelect, onDebugGrouping }: ThreadRowProps) {
	const rowRef = useRef<HTMLDivElement>(null);

	useCollapseWhileRemoving(rowRef, isRemoving);

	const senders = Array.isArray(thread.senders) ? thread.senders : [];
	const receivers = Array.isArray(thread.receivers) ? thread.receivers : [];
	const mainDisplayedLabelIds = getThreadMainDisplayedLabelIds(thread);

	function handleRowClick(e: React.MouseEvent<HTMLDivElement>) {
		e.stopPropagation();
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
			senders: senders,
			receivers: receivers,
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
					<SenderSummary
						senders={senders}
						title={renderParticipants(senders)}
						onAddSenderRule={onAddSenderRule}
					/>
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
								className="btn btn-sm btn-success archive-thread"
								title="Done"
								onClick={function(e) { e.stopPropagation(); onArchive(thread.threadId); }}
							>
								<span className="glyphicon glyphicon-ok"></span>
							</button>
							<button
								className="btn btn-sm btn-danger delete"
								title="Delete"
								onClick={function(e) { e.stopPropagation(); onDelete(thread.threadId); }}
							>
								<span className="glyphicon glyphicon-remove"></span>
							</button>
							<button
								className="btn btn-sm btn-warning later"
								title="Later"
								onClick={function(e) { e.stopPropagation(); onOpenLaterPicker({ threadId: thread.threadId, subject: thread.subject || '' }); }}
							>
								<span className="glyphicon glyphicon-time"></span>
							</button>
							<button
								className="btn btn-sm btn-primary label-thread"
								title="Label"
								onClick={function(e) { e.stopPropagation(); onOpenLabelPicker({ threadId: thread.threadId, subject: thread.subject || '' }); }}
							>
								<span className="glyphicon glyphicon-list"></span>
							</button>
							<button
								className="btn btn-sm btn-info mark-spam"
								title="Report spam"
								onClick={function(e) { e.stopPropagation(); onMarkSpam(thread.threadId); }}
							>
								<span className="glyphicon glyphicon-ban-circle"></span>
							</button>
							<a
								className="btn btn-sm btn-default view-on-gmail"
								title="View on Gmail"
								href={'https://mail.google.com/mail/u/0/#inbox/' + thread.threadId}
								target="_blank"
								rel="noreferrer"
								onClick={function(e) { e.stopPropagation(); }}
							>
								<span className="glyphicon glyphicon-option-horizontal"></span>
							</a>
							<button
								className="btn btn-sm btn-default debug-grouping"
								title="Debug grouping rules"
								onClick={function(e) { e.stopPropagation(); onDebugGrouping(thread); }}
							>
								<span className="glyphicon glyphicon-search"></span>
							</button>
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
	showCheckbox?: boolean;
	isSelected?: boolean;
	onAddSenderRule: (senderEmail: string) => void;
	onArchive: (bundleId: string) => void;
	onEdit: (bundle: BundleSummary) => void;
	onOpenLaterPicker: (payload: BundleLaterPickerPayload) => void;
	onOpenLabelPicker: (payload: BundleLaterPickerPayload) => void;
	onUngroup: (bundleId: string) => void;
	onToggleExpand: (bundleId: string) => void;
	onToggleSelectBundle?: (bundle: BundleSummary) => void;
	onDebugGrouping: (item: ThreadRowItem) => void;
}

function BundleRow({ bundle, isExpanded, isRemoving, children, showCheckbox, isSelected, onAddSenderRule, onArchive, onEdit, onOpenLaterPicker, onOpenLabelPicker, onUngroup, onToggleExpand, onToggleSelectBundle, onDebugGrouping }: BundleRowProps) {
	const rowRef = useRef<HTMLDivElement>(null);

	useCollapseWhileRemoving(rowRef, isRemoving);

	const senders = Array.isArray(bundle.senders) ? bundle.senders : [];

	function handleRowClick(e: React.MouseEvent<HTMLDivElement>) {
		if ((e.target as Element).closest('button, a, input, select, textarea, label')) {
			return;
		}
		if (showCheckbox && onToggleSelectBundle) {
			onToggleSelectBundle(bundle);
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
					{showCheckbox ? (
						<input
							type="checkbox"
							checked={isSelected || false}
							onChange={function() { onToggleSelectBundle?.(bundle); }}
							onClick={function(e) { e.stopPropagation(); }}
							style={{marginRight: '8px'}}
						/>
					) : null}
					<span className="glyphicon glyphicon-duplicate" title="Bundle" style={{marginRight: '6px'}}></span>
					<strong>From&nbsp;</strong>
					<SenderSummary
						senders={senders}
						title={senders.map(formatPerson).join(', ')}
						onAddSenderRule={onAddSenderRule}
					/>
					<span className="badge" style={{marginLeft: '6px'}}>{bundle.threadCount} threads</span>
				</div>
				<div className="col-xs-2">
					<span className="glyphicon glyphicon-folder-open"></span>&nbsp;
					{formatPrettyTimestamp(bundle.lastUpdated)}
				</div>
			</div>
			<div className="row">
				<div className="col-xs-10">
					{bundle.subject ? <strong className="subject">{bundle.subject}</strong> : null}
					{bundle.snippet ? <p className="snippet">{bundle.snippet}</p> : null}
				</div>
				<div className="col-xs-2">
					<small>Total:</small>
					<span className="glyphicon glyphicon-time"></span>{' '}
					{formatReadTime(bundle.totalTimeToReadSeconds) as string}
					<br />
					<small>Recent:</small>
					<span className="glyphicon glyphicon-time"></span>{' '}
					{formatReadTime(bundle.recentMessageReadTimeSeconds) as string}
					<br />
					<button
						className="btn btn-sm btn-success archive-thread"
						title="Archive all"
						onClick={function(e) { e.stopPropagation(); onArchive(bundle.bundleId); }}
					>
						<span className="glyphicon glyphicon-ok"></span>
					</button>
					<button
						className="btn btn-sm btn-warning later"
						title="Later"
						onClick={function(e) { e.stopPropagation(); onOpenLaterPicker({ bundleId: bundle.bundleId }); }}
					>
						<span className="glyphicon glyphicon-time"></span>
					</button>
					<button
						className="btn btn-sm btn-primary label-bundle"
						title="Label all"
						onClick={function(e) { e.stopPropagation(); onOpenLabelPicker({ bundleId: bundle.bundleId }); }}
					>
						<span className="glyphicon glyphicon-list"></span>
					</button>
					<button
						className="btn btn-sm btn-info"
						title="Edit bundle membership"
						onClick={function(e) { e.stopPropagation(); onEdit(bundle); }}
					>
						<span className="glyphicon glyphicon-pencil"></span>
					</button>
					<button
						className="btn btn-sm btn-default"
						title="Ungroup"
						onClick={function(e) { e.stopPropagation(); onUngroup(bundle.bundleId); }}
					>
						<span className="glyphicon glyphicon-scissors"></span>
					</button>
					<button
						className="btn btn-sm btn-default debug-grouping"
						title="Debug grouping rules"
						onClick={function(e) { e.stopPropagation(); onDebugGrouping(bundle); }}
					>
						<span className="glyphicon glyphicon-search"></span>
					</button>
				</div>
			</div>
			{isExpanded && children ? (
				<div className="bundle-expanded-threads" style={{borderTop: '1px solid #ddd', borderLeft: '3px solid #aaa', marginTop: '4px', marginLeft: '16px', paddingLeft: '12px'}}>
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
	groups: readonly ThreadGroup[];
	labels: LabelInfo[];
	removingThreadIds: Set<string>;
	removingBundleIds: Set<string>;
	onAddSenderRule: (senderEmail: string) => void;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onMarkSpam: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
	onCreateBundle: (threadIds: string[]) => void;
	onEditBundle: (bundleId: string, threadIds: string[], mergeBundleIds: string[]) => void;
	onArchiveBundle: (bundleId: string) => void;
	onOpenLaterPickerForBundle: (payload: BundleLaterPickerPayload) => void;
	onOpenLabelPickerForBundle: (payload: BundleLaterPickerPayload) => void;
	onUngroup: (bundleId: string) => void;
	onDebugGrouping: (item: ThreadRowItem) => void;
}

function ThreadListApp({ groups, labels, removingThreadIds, removingBundleIds, onAddSenderRule, onArchive, onDelete, onMarkSpam, onOpenLaterPicker, onOpenLabelPicker, onOpenThread, onCreateBundle, onEditBundle, onArchiveBundle, onOpenLaterPickerForBundle, onOpenLabelPickerForBundle, onUngroup, onDebugGrouping }: ThreadListAppProps) {
	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
	const [selectedMergeBundleIds, setSelectedMergeBundleIds] = useState<Set<string>>(new Set());
	const [expandedBundleIds, setExpandedBundleIds] = useState<Set<string>>(new Set());
	const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<'classic' | 'quick-deal'>('classic');

	if (!groups || groups.length === 0) {
		return null;
	}

	// Build a set of all bundled thread IDs across all groups (for selection mode filtering)
	const bundledThreadIds = new Set<string>();
	for (const group of groups) {
		for (const item of group.items) {
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
		const mergeBundleIds = Array.from(selectedMergeBundleIds);
		setSelectionMode(false);
		setSelectedThreadIds(new Set());
		setSelectedMergeBundleIds(new Set());
		setEditingBundleId(null);
		if (editingBundleId) {
			onEditBundle(editingBundleId, threadIds, mergeBundleIds);
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

	function handleToggleSelectBundle(bundle: BundleSummary) {
		const nextMerge = new Set(selectedMergeBundleIds);
		const nextThreads = new Set(selectedThreadIds);
		if (nextMerge.has(bundle.bundleId)) {
			nextMerge.delete(bundle.bundleId);
			for (const tid of bundle.threadIds) {
				nextThreads.delete(tid);
			}
		} else {
			nextMerge.add(bundle.bundleId);
			for (const tid of bundle.threadIds) {
				nextThreads.add(tid);
			}
		}
		setSelectedMergeBundleIds(nextMerge);
		setSelectedThreadIds(nextThreads);
	}

	function handleCancelSelection() {
		setSelectionMode(false);
		setSelectedThreadIds(new Set());
		setSelectedMergeBundleIds(new Set());
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

	function renderItemRow(item: ThreadRowItem): React.ReactElement {
		if (item.type === 'bundle') {
			const bundle = item as BundleSummary;
			const isExpanded = expandedBundleIds.has(bundle.bundleId);
			return (
				<BundleRow
					key={bundle.bundleId}
					bundle={bundle}
					isExpanded={isExpanded}
					isRemoving={removingBundleIds.has(bundle.bundleId)}
					showCheckbox={selectionMode && editingBundleId !== null && editingBundleId !== bundle.bundleId}
					isSelected={selectedMergeBundleIds.has(bundle.bundleId)}
					onAddSenderRule={onAddSenderRule}
					onArchive={onArchiveBundle}
					onEdit={handleEditBundle}
					onOpenLaterPicker={onOpenLaterPickerForBundle}
					onOpenLabelPicker={onOpenLabelPickerForBundle}
					onUngroup={onUngroup}
					onToggleExpand={handleToggleExpand}
					onToggleSelectBundle={handleToggleSelectBundle}
					onDebugGrouping={onDebugGrouping}
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
								onAddSenderRule={onAddSenderRule}
								onArchive={onArchive}
								onDelete={onDelete}
								onMarkSpam={onMarkSpam}
								onOpenLaterPicker={onOpenLaterPicker}
								onOpenLabelPicker={onOpenLabelPicker}
								onOpenThread={onOpenThread}
								onToggleSelect={handleToggleSelect}
								onDebugGrouping={onDebugGrouping}
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
				onAddSenderRule={onAddSenderRule}
				onArchive={onArchive}
				onDelete={onDelete}
				onMarkSpam={onMarkSpam}
				onOpenLaterPicker={onOpenLaterPicker}
				onOpenLabelPicker={onOpenLabelPicker}
				onOpenThread={onOpenThread}
				onToggleSelect={handleToggleSelect}
				onDebugGrouping={onDebugGrouping}
			/>
		);
	}

	return (
		<React.Fragment>
			<div style={{position: 'sticky', top: 0, zIndex: 10, background: '#fff'}}>
				<div className="thread-list-header" style={{display: 'flex', justifyContent: 'space-between', padding: '4px 8px'}}>
					<button
						className={'btn btn-xs ' + (viewMode === 'quick-deal' ? 'btn-primary' : 'btn-default')}
						title="Show all emails sorted by recent read time, with 'When I have time' emails at the bottom"
						onClick={() => setViewMode(viewMode === 'quick-deal' ? 'classic' : 'quick-deal')}
					>
						<span className="glyphicon glyphicon-flash"></span>{' '}
						{viewMode === 'quick-deal' ? 'Classic View' : 'Quick Deal'}
					</button>
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
			</div>
			{viewMode === 'quick-deal' ? (function() {
				const allItems = groups.flatMap(function(g) { return g.items; });
				const normalItems = allItems.filter(function(item) { return item.visibility !== 'when-i-have-time'; });
				const laterItems = allItems.filter(function(item) { return item.visibility === 'when-i-have-time'; });
				function byRecentTime(a: ThreadRowItem, b: ThreadRowItem) {
					return a.recentMessageReadTimeSeconds - b.recentMessageReadTimeSeconds;
				}
				const sortedItems = [...normalItems.sort(byRecentTime), ...laterItems.sort(byRecentTime)];
				return sortedItems.map(renderItemRow);
			})() : groups.map(function(group, groupIdx) {
				const items: ThreadRowItem[] = group.items;

				const groupTotalTime = items.reduce(function(sum, item) {
					return sum + item.totalTimeToReadSeconds;
				}, 0);
				const groupRecentTime = items.reduce(function(sum, item) {
					return sum + item.recentMessageReadTimeSeconds;
				}, 0);

				return (
					<React.Fragment key={groupIdx}>
						<div className="group">
							{group.label || ''}
							<span style={{marginLeft: '8px', fontWeight: 'normal', fontSize: '0.85em', color: '#666'}}>
								{items.length} item{items.length !== 1 ? 's' : ''}
								{' · '}Total: {formatReadTime(groupTotalTime)}
								{' · '}Recent: {formatReadTime(groupRecentTime)}
							</span>
						</div>
						{items.map(renderItemRow)}
					</React.Fragment>
				);
			})}
		</React.Fragment>
	);
}

const REMOVE_ANIMATION_MS = 400;

interface MountThreadListIslandDeps {
	container: Element;
	onAddSenderRule: (senderEmail: string) => void;
	onArchive: (threadId: string) => void;
	onDelete: (threadId: string) => void;
	onMarkSpam: (threadId: string) => void;
	onOpenLaterPicker: (payload: LaterPickerPayload) => void;
	onOpenLabelPicker: (payload: LaterPickerPayload) => void;
	onOpenThread: (payload: ThreadOpenPayload) => void;
	onCreateBundle: (threadIds: string[]) => void;
	onEditBundle: (bundleId: string, threadIds: string[], mergeBundleIds: string[]) => void;
	onArchiveBundle: (bundleId: string) => void;
	onOpenLaterPickerForBundle: (payload: BundleLaterPickerPayload) => void;
	onOpenLabelPickerForBundle: (payload: BundleLaterPickerPayload) => void;
	onUngroup: (bundleId: string) => void;
	onDebugGrouping: (item: ThreadRowItem) => void;
}

export function mountThreadListIsland({ container, onAddSenderRule, onArchive, onDelete, onMarkSpam, onOpenLaterPicker, onOpenLabelPicker, onOpenThread, onCreateBundle, onEditBundle, onArchiveBundle, onOpenLaterPickerForBundle, onOpenLabelPickerForBundle, onUngroup, onDebugGrouping }: MountThreadListIslandDeps) {
	const root = createRoot(container);
	let latestGroups: readonly ThreadGroup[] = [];
	/** Rows that left the latest groups and are still animating out, by item key. */
	let animatingRows: ReadonlyMap<string, AnimatingRow> = new Map();
	let nextAnimationToken = 0;
	let labels: LabelInfo[] = [];

	function render() {
		root.render(
			<ThreadListApp
				groups={groupsWithAnimatingRows(latestGroups, animatingRows)}
				labels={labels}
				removingThreadIds={animatingIds('thread')}
				removingBundleIds={animatingIds('bundle')}
				onAddSenderRule={onAddSenderRule}
				onArchive={onArchive}
				onDelete={onDelete}
				onMarkSpam={onMarkSpam}
				onOpenLaterPicker={onOpenLaterPicker}
				onOpenLabelPicker={onOpenLabelPicker}
				onOpenThread={onOpenThread}
				onCreateBundle={onCreateBundle}
				onEditBundle={onEditBundle}
				onArchiveBundle={onArchiveBundle}
				onOpenLaterPickerForBundle={onOpenLaterPickerForBundle}
				onOpenLabelPickerForBundle={onOpenLabelPickerForBundle}
				onUngroup={onUngroup}
				onDebugGrouping={onDebugGrouping}
			/>
		);
	}

	function animatingIds(type: 'thread' | 'bundle'): Set<string> {
		return new Set([...animatingRows.values()].flatMap(function(row) {
			return row.item.type === 'bundle'
				? (type === 'bundle' ? [row.item.bundleId] : [])
				: (type === 'thread' ? [row.item.threadId] : []);
		}));
	}

	render();

	return {
		/**
		 * Replaces the list contents. Rows that were on screen and are absent from the new groups
		 * play the removal animation before they are dropped; rows that come back just show.
		 */
		/**
		 * Replaces the list contents. Rows that were on screen and are absent from the new groups
		 * play the removal animation before they are dropped; rows that come back just show.
		 */
		setGroups: function(newGroups: readonly ThreadGroup[]) {
			const displayedBefore = groupsWithAnimatingRows(latestGroups, animatingRows);
			const stillGone = new Map(goneItems(displayedBefore, newGroups).map(function(row) {
				return [itemKey(row.item), row];
			}));
			// Rows already animating keep their animation; rows that came back stop animating.
			const kept = [...animatingRows].filter(function([key]) { return stillGone.has(key); });
			const started = [...stillGone]
				.filter(function([key]) { return !animatingRows.has(key); })
				.map(function([key, row]): [string, AnimatingRow] {
					nextAnimationToken += 1;
					return [key, { ...row, token: nextAnimationToken }];
				});
			latestGroups = newGroups;
			animatingRows = new Map([...kept, ...started]);
			render();
			started.forEach(function([key, row]) {
				setTimeout(function() {
					// Only clear the animation this timer started.
					if (animatingRows.get(key)?.token !== row.token) {
						return;
					}
					animatingRows = new Map([...animatingRows].filter(function([k]) { return k !== key; }));
					render();
				}, REMOVE_ANIMATION_MS);
			});
		},
		setLabels: function(newLabels: LabelInfo[]) {
			labels = newLabels;
			render();
		},
		unmount: function() {
			root.unmount();
		},
	};
}
