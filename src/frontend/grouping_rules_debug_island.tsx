import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import type {GroupingRulesConfig, ThreadRowItem, ThreadSummary, BundleSummary} from './thread_grouping.js';
import {traceGrouping, type ConditionTrace, type RuleTrace, type ThreadEvaluation, type GroupingTrace} from './grouping_rules_debug.js';

interface DebugAppProps {
	item: ThreadRowItem | null;
	groupingRules: GroupingRulesConfig;
	onClose: () => void;
}

function ConditionRow({condition}: {condition: ConditionTrace}) {
	const iconClass = condition.matched ? 'glyphicon glyphicon-ok' : 'glyphicon glyphicon-remove';
	const iconColor = condition.matched ? '#3c763d' : '#a94442';
	return (
		<li style={{marginBottom: '6px'}}>
			<span className={iconClass} style={{color: iconColor, marginRight: '6px'}}></span>
			<span>{condition.reason}</span>
			{condition.details.length > 0 ? (
				<ul style={{marginTop: '4px', marginBottom: '0', color: '#555'}}>
					{condition.details.map((detail, idx) => (
						<li key={idx} style={{listStyle: 'none'}}>
							<span
								className={'glyphicon ' + (detail.matched ? 'glyphicon-arrow-right' : 'glyphicon-minus')}
								style={{color: detail.matched ? '#3c763d' : '#999', marginRight: '6px', fontSize: '0.8em'}}
							></span>
							<code>{detail.value}</code>
							{detail.matched ? <span style={{color: '#3c763d'}}> &nbsp;(match)</span> : null}
						</li>
					))}
				</ul>
			) : null}
		</li>
	);
}

function ThreadEvaluationBlock({evaluation, threadIndex}: {evaluation: ThreadEvaluation; threadIndex: number}) {
	const borderColor = evaluation.matched ? '#3c763d' : '#ccc';
	const headerColor = evaluation.matched ? '#3c763d' : '#999';
	const headerLabel = evaluation.matched ? 'Matched' : 'Did not match';
	return (
		<div style={{borderLeft: `3px solid ${borderColor}`, paddingLeft: '10px', marginBottom: '10px'}}>
			<div style={{marginBottom: '4px'}}>
				<strong>Thread #{threadIndex + 1}</strong>{' '}
				<small className="text-muted">{evaluation.threadId}</small>
				<span style={{color: headerColor, fontWeight: 'bold', marginLeft: '8px'}}>{headerLabel}</span>
			</div>
			{evaluation.subject ? (
				<div style={{marginBottom: '4px', color: '#555'}}>
					<small><strong>Subject:</strong> {evaluation.subject}</small>
				</div>
			) : null}
			{evaluation.conditions.length === 0 ? (
				<div className="text-muted">Rule has no conditions.</div>
			) : (
				<ul style={{paddingLeft: '20px'}}>
					{evaluation.conditions.map((condition, idx) => (
						<ConditionRow key={idx} condition={condition} />
					))}
				</ul>
			)}
		</div>
	);
}

function RulePanel({ruleTrace, ruleIndex, isBundle}: {ruleTrace: RuleTrace; ruleIndex: number; isBundle: boolean}) {
	let panelClass = 'panel panel-default';
	let headerLabel = 'Did not match';
	let headerColor = '#999';
	if (ruleTrace.skipped) {
		panelClass = 'panel panel-default';
		headerLabel = 'Skipped';
		headerColor = '#999';
	} else if (ruleTrace.matched) {
		panelClass = 'panel panel-success';
		headerLabel = 'Matched';
		headerColor = '#3c763d';
	}
	return (
		<div className={panelClass} style={{marginBottom: '10px'}}>
			<div className="panel-heading">
				<strong>#{ruleIndex + 1}</strong>{' '}
				<strong>{ruleTrace.ruleName || '(unnamed)'}</strong>{' '}
				<small className="text-muted">priority {ruleTrace.priority}</small>{' '}
				<span className="pull-right" style={{color: headerColor, fontWeight: 'bold'}}>
					{headerLabel}
				</span>
			</div>
			<div className="panel-body">
				{ruleTrace.skipped ? (
					<div className="text-muted">{ruleTrace.skippedReason}</div>
				) : isBundle ? (
					(() => {
						const evaluations = ruleTrace.threadEvaluations || [];
						if (evaluations.length === 0) {
							return <div className="text-muted">Bundle has no member threads to evaluate.</div>;
						}
						return (
							<>
								<p style={{marginBottom: '10px'}}>
									<small className="text-muted">
										A bundle matches this rule if <strong>any</strong> of its member threads matches.
									</small>
								</p>
								{evaluations.map((evaluation, idx) => (
									<ThreadEvaluationBlock key={evaluation.threadId || idx} evaluation={evaluation} threadIndex={idx} />
								))}
							</>
						);
					})()
				) : (ruleTrace.conditions || []).length === 0 ? (
					<div className="text-muted">Rule has no conditions, so it cannot match.</div>
				) : (
					<ul style={{paddingLeft: '20px'}}>
						{(ruleTrace.conditions || []).map((condition, idx) => (
							<ConditionRow key={idx} condition={condition} />
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function ItemSummary({item}: {item: ThreadRowItem}) {
	const senders = item.senders || [];
	const senderText = senders
		.map((s) => (s.name || s.email || ''))
		.filter(Boolean)
		.join(', ') || '(none)';
	if (item.type === 'bundle') {
		const bundle = item as BundleSummary;
		return (
			<div style={{marginBottom: '15px'}}>
				<div><strong>Type:</strong> Bundle</div>
				<div><strong>Bundle ID:</strong> {bundle.bundleId}</div>
				<div><strong>Threads:</strong> {bundle.threadCount}</div>
				<div><strong>Senders:</strong> {senderText}</div>
			</div>
		);
	}
	const thread = item as ThreadSummary;
	return (
		<div style={{marginBottom: '15px'}}>
			<div><strong>Type:</strong> Thread</div>
			<div><strong>Thread ID:</strong> {thread.threadId}</div>
			<div><strong>Subject:</strong> {thread.subject || '(none)'}</div>
			<div><strong>Senders:</strong> {senderText}</div>
		</div>
	);
}

function DebugApp({item, groupingRules, onClose}: DebugAppProps) {
	if (!item) {
		return null;
	}
	const trace: GroupingTrace = traceGrouping(item, groupingRules);
	return (
		<>
			<div className="modal-header">
				<button type="button" className="close" onClick={onClose} aria-label="Close">
					<span aria-hidden="true">&times;</span>
				</button>
				<h4 className="modal-title">Grouping Rule Debug</h4>
			</div>
			<div className="modal-body">
				<ItemSummary item={item} />
				<div className="alert alert-info">
					{trace.matchedRuleName !== null ? (
						<>
							<strong>Result:</strong> Matched rule <strong>"{trace.matchedRuleName}"</strong>
							{' '}&rarr; placed in group <strong>"{trace.finalGroupLabel}"</strong>.
						</>
					) : (
						<>
							<strong>Result:</strong> No rules matched. Placed in group{' '}
							<strong>"{trace.finalGroupLabel}"</strong>.
						</>
					)}
				</div>
				{trace.rules.length === 0 ? (
					<p className="text-muted">No grouping rules are configured.</p>
				) : (
					trace.rules.map((ruleTrace, idx) => (
						<RulePanel key={idx} ruleTrace={ruleTrace} ruleIndex={idx} isBundle={item.type === 'bundle'} />
					))
				)}
			</div>
			<div className="modal-footer">
				<button className="btn btn-default" type="button" onClick={onClose}>Close</button>
			</div>
		</>
	);
}

export interface MountGroupingRulesDebugIslandDeps {
	container: Element;
	showModal: () => void;
	hideModal: () => void;
}

export interface GroupingRulesDebugIsland {
	open(item: ThreadRowItem, groupingRules: GroupingRulesConfig): void;
	clear(): void;
	unmount(): void;
}

export function mountGroupingRulesDebugIsland({
	container,
	showModal,
	hideModal,
}: MountGroupingRulesDebugIslandDeps): GroupingRulesDebugIsland {
	const root: Root = createRoot(container);
	let currentItem: ThreadRowItem | null = null;
	let currentRules: GroupingRulesConfig = {rules: []};

	function render() {
		root.render(
			<DebugApp
				item={currentItem}
				groupingRules={currentRules}
				onClose={hideModal}
			/>
		);
	}

	render();

	return {
		open(item: ThreadRowItem, groupingRules: GroupingRulesConfig) {
			currentItem = item;
			currentRules = groupingRules;
			render();
			showModal();
		},
		clear() {
			currentItem = null;
			render();
		},
		unmount() {
			root.unmount();
		},
	};
}
