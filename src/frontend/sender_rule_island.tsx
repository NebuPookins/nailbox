import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CONDITION_TYPE_CONTAINS_LABELS } from './thread_grouping.js';
import type { ConditionType, GroupingRulesConfig } from './thread_grouping.js';
import type { JsonValue, Result } from './api.js';
import { addCondition, describeConditions, resolvePattern } from './sender_rule_presenter.js';

const CONDITION_TYPE_OPTIONS = Object.entries(CONDITION_TYPE_CONTAINS_LABELS) as Array<[ConditionType, string]>;

const MODAL_TITLES: Record<ConditionType, string> = {
	sender_email: 'Group emails from this sender',
	sender_name: 'Group emails by sender name',
	subject: 'Group emails by subject',
};

const CONDITION_TYPE_EXAMPLES: Record<ConditionType, React.ReactNode> = {
	sender_email: <>e.g. <code>@example.com</code> matches every sender at that domain.</>,
	sender_name: <>e.g. <code>acme</code> matches any sender name containing it.</>,
	subject: <>e.g. <code>invoice</code> matches any subject containing it.</>,
};

interface SenderRuleApi {
	loadRules(): Promise<Result<GroupingRulesConfig>>;
	saveRules(config: GroupingRulesConfig): Promise<Result<JsonValue>>;
}

interface SenderRuleAppProps {
	api: SenderRuleApi;
	senderEmail: string;
	onClose: () => void;
	onSaved: () => void;
}

function toErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function SenderRuleApp({ api, senderEmail, onClose, onSaved }: SenderRuleAppProps) {
	const [conditionType, setConditionType] = useState<ConditionType>('sender_email');
	const [patternsByType, setPatternsByType] = useState<Partial<Record<ConditionType, string>>>({});
	const [config, setConfig] = useState<GroupingRulesConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [pendingRuleIndex, setPendingRuleIndex] = useState<number | null>(null);
	const [errorMessage, setErrorMessage] = useState('');
	const pattern = resolvePattern(patternsByType, conditionType, senderEmail);

	useEffect(function() {
		let isCancelled = false;
		setLoading(true);
		setErrorMessage('');

		async function loadRules() {
			try {
				const result = await api.loadRules();
				if (isCancelled) {
					return;
				}
				if (!result.ok) {
					setErrorMessage(result.error.message || 'Failed to load email grouping rules.');
					return;
				}
				setConfig(result.value);
			} catch (error: unknown) {
				if (!isCancelled) {
					setErrorMessage(toErrorMessage(error, 'Failed to load email grouping rules.'));
				}
			} finally {
				if (!isCancelled) {
					setLoading(false);
				}
			}
		}

		loadRules();

		return function() {
			isCancelled = true;
		};
	}, [api, senderEmail]);

	const trimmedPattern = pattern.trim();

	function handlePatternChange(value: string) {
		setPatternsByType(function(prev) {
			return { ...prev, [conditionType]: value };
		});
	}

	async function handleRuleClick(ruleIndex: number) {
		if (!config || trimmedPattern.length === 0) {
			return;
		}
		setPendingRuleIndex(ruleIndex);
		setErrorMessage('');
		try {
			const result = await api.saveRules(addCondition(config, ruleIndex, conditionType, trimmedPattern));
			if (!result.ok) {
				setErrorMessage(result.error.message || 'Failed to save email grouping rules.');
				return;
			}
			onSaved();
			onClose();
		} catch (error: unknown) {
			setErrorMessage(toErrorMessage(error, 'Failed to save email grouping rules.'));
		} finally {
			setPendingRuleIndex(null);
		}
	}

	const rules = config ? config.rules : [];

	return (
		<>
			<div className="modal-header">
				<button type="button" className="close" onClick={onClose} aria-label="Close">
					<span aria-hidden="true">&times;</span>
				</button>
				<h4 className="modal-title">{MODAL_TITLES[conditionType]}</h4>
			</div>
			<div className="modal-body">
				<label htmlFor="sender-rule-condition-type">Match</label>
				<select
					className="form-control"
					id="sender-rule-condition-type"
					onChange={function(e) { setConditionType(e.target.value as ConditionType); }}
					style={{ marginBottom: '10px' }}
					value={conditionType}
				>
					{CONDITION_TYPE_OPTIONS.map(function([value, label]) {
						return <option key={value} value={value}>{label}</option>;
					})}
				</select>
				<label htmlFor="sender-rule-pattern">Value to match</label>
				<input
					autoFocus
					className="form-control"
					id="sender-rule-pattern"
					onChange={function(e) { handlePatternChange(e.target.value); }}
					type="text"
					value={pattern}
				/>
				<p className="text-muted" style={{ marginTop: '6px' }}>
					This is a case-sensitive substring match, so shortening it widens what it matches.{' '}
					{CONDITION_TYPE_EXAMPLES[conditionType]}
				</p>
				{errorMessage ? (
					<div className="alert alert-danger">{errorMessage}</div>
				) : null}
				<hr />
				{loading ? (
					<p className="text-muted">Loading rules...</p>
				) : config === null ? (
					<p className="text-muted">
						The rules could not be loaded, so there is nothing to add this sender to.
						Close and reopen this window to try again.
					</p>
				) : rules.length === 0 ? (
					<p className="text-muted">
						No grouping rules defined yet. Create one under "Email Grouping Settings" first.
					</p>
				) : (
					<>
						<p>Add this condition to:</p>
						<div className="sender-rule-grid">
							{rules.map(function(rule, ruleIndex) {
								const existing = describeConditions(rule, conditionType);
								return (
									<button
										className="btn btn-default sender-rule-choice"
										disabled={trimmedPattern.length === 0 || pendingRuleIndex !== null}
										key={ruleIndex}
										onClick={function() { handleRuleClick(ruleIndex); }}
										title={existing ? 'Conditions so far: ' + existing : 'No matching conditions yet'}
										type="button"
									>
										{pendingRuleIndex === ruleIndex ? 'Saving...' : (rule.name || '(unnamed)')}
									</button>
								);
							})}
						</div>
					</>
				)}
			</div>
			<div className="modal-footer">
				<button className="btn btn-default" type="button" onClick={onClose}>Cancel</button>
			</div>
		</>
	);
}

export interface MountSenderRuleIslandDeps {
	api: SenderRuleApi;
	container: Element;
	showModal: () => void;
	hideModal: () => void;
	onSaved: () => void;
}

export interface SenderRuleIsland {
	open(senderEmail: string): void;
	clear(): void;
	unmount(): void;
}

export function mountSenderRuleIsland({
	api,
	container,
	showModal,
	hideModal,
	onSaved,
}: MountSenderRuleIslandDeps): SenderRuleIsland {
	const root: Root = createRoot(container);
	let senderEmail: string | null = null;
	let openCount = 0;

	function render() {
		root.render(senderEmail === null ? null : (
			<SenderRuleApp
				api={api}
				key={openCount}
				onClose={hideModal}
				onSaved={onSaved}
				senderEmail={senderEmail}
			/>
		));
	}

	render();

	return {
		open(nextSenderEmail: string) {
			senderEmail = nextSenderEmail;
			openCount += 1;
			render();
			showModal();
		},
		clear() {
			senderEmail = null;
			render();
		},
		unmount() {
			root.unmount();
		},
	};
}
