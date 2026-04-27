import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type ConditionType, type SortType, type GroupingRulesConfig } from './thread_grouping.js';
import { type Result } from './api.js';

interface Condition {
	type: ConditionType;
	value: string;
}

interface Rule {
	name: string;
	priority: number;
	sortType: SortType;
	conditions: Condition[];
}

interface GroupingRulesApi {
	loadRules(): Promise<Result<GroupingRulesConfig>>;
	saveRules(payload: unknown): Promise<Result<unknown>>; //TODO: Avoid use of unknown.
}

function createEmptyRule(): Rule {
	return {
		name: 'New Rule',
		priority: 50,
		sortType: 'mostRecent',
		conditions: [],
	};
}

function normalizeRule(rule: unknown): Rule {
	const r = rule as Record<string, unknown>; //TODO: Avoid use of unknown.
	return {
		name: typeof r?.name === 'string' ? r.name : '',
		priority: Number.isFinite(Number(r?.priority)) ? Number(r.priority) : 50,
		sortType: r?.sortType === 'shortest' ? 'shortest' : 'mostRecent',
		conditions: Array.isArray(r?.conditions) ? r.conditions.map((condition: unknown) => {
			const c = condition as Record<string, unknown>;
			return {
				type: c?.type === 'sender_name' || c?.type === 'sender_email' || c?.type === 'subject'
					? (c.type as ConditionType)
					: 'sender_email' as ConditionType,
				value: typeof c?.value === 'string' ? c.value : '',
			};
		}) : [],
	};
}

function GroupingRulesApp({ api, onSaved, reloadToken }: {
	api: GroupingRulesApi;
	onSaved: (() => void) | undefined;
	reloadToken: number;
}) {
	const [rules, setRules] = useState<Rule[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');

	useEffect(() => {
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
					const message = result.error instanceof Error && result.error.message
						? result.error.message
						: 'Failed to load email grouping rules.';
					setErrorMessage(message);
					return;
				}
				const data = result.value;
				const nextRules = Array.isArray(data?.rules) ? data.rules.map(normalizeRule) : [];
				setRules(nextRules);
			} finally {
				if (!isCancelled) {
					setLoading(false);
				}
			}
		}

		loadRules();

		return () => {
			isCancelled = true;
		};
	}, [api, reloadToken]);

	function updateRule(ruleIndex: number, updater: (rule: Rule) => Rule) {
		setRules((currentRules) => currentRules.map((rule, index) => (
			index === ruleIndex ? updater(rule) : rule
		)));
	}

	function addRule() {
		setRules((currentRules) => currentRules.concat(createEmptyRule()));
	}

	function removeRule(ruleIndex: number) {
		setRules((currentRules) => currentRules.filter((_, index) => index !== ruleIndex));
	}

	function addCondition(ruleIndex: number) {
		updateRule(ruleIndex, (rule) => ({
			...rule,
			conditions: rule.conditions.concat({ type: 'sender_email', value: '' }),
		}));
	}

	function updateCondition(ruleIndex: number, conditionIndex: number, updater: (condition: Condition) => Condition) {
		updateRule(ruleIndex, (rule) => ({
			...rule,
			conditions: rule.conditions.map((condition, index) => (
				index === conditionIndex ? updater(condition) : condition
			)),
		}));
	}

	function removeCondition(ruleIndex: number, conditionIndex: number) {
		updateRule(ruleIndex, (rule) => ({
			...rule,
			conditions: rule.conditions.filter((_, index) => index !== conditionIndex),
		}));
	}

	function saveRules() {
		setSaving(true);
		setErrorMessage('');
		Promise.resolve(api.saveRules({ rules })) //TODO: use async instead.
			.then((result) => {
				if (!result.ok) {
					throw result.error;
				}
				onSaved?.();
			})
			.catch((error: unknown) => { //TODO: Instead of throw/catch, inspect result.
				const message = error instanceof Error && error.message
					? error.message
					: 'Failed to save email grouping rules.';
				setErrorMessage(message);
			})
			.finally(() => {
				setSaving(false);
			});
	}

	return (
		<div className="grouping-rules-app">
			<div className="row">
				<div className="col-xs-12">
					<p>Configure how emails are grouped and prioritized. Rules are checked in order, and the first matching rule determines the group.</p>
					<button className="btn btn-success" onClick={addRule} type="button">
						<span className="glyphicon glyphicon-plus" /> Add New Rule
					</button>
				</div>
			</div>
			{errorMessage ? (
				<div className="alert alert-danger" style={{ marginTop: '15px' }}>{errorMessage}</div>
			) : null}
			<div style={{ marginTop: '15px', maxHeight: '500px', overflowY: 'auto' }}>
				{loading ? (
					<p className="text-muted">Loading rules...</p>
				) : rules.length === 0 ? (
					<p className="text-muted">No rules defined yet.</p>
				) : rules.map((rule, ruleIndex) => (
					<div className="panel panel-default" key={`${ruleIndex}-${reloadToken}`} style={{ marginBottom: '15px' }}>
						<div className="panel-heading">
							<div className="row">
								<div className="col-xs-12 col-sm-3">
									<input
										className="form-control"
										onChange={(event) => updateRule(ruleIndex, (currentRule) => ({ ...currentRule, name: event.target.value }))}
										placeholder="Rule Name"
										type="text"
										value={rule.name}
									/>
								</div>
								<div className="col-xs-12 col-sm-2">
									<input
										className="form-control"
										onChange={(event) => updateRule(ruleIndex, (currentRule) => ({
											...currentRule,
											priority: Number.parseInt(event.target.value, 10) || 50,
										}))}
										placeholder="Priority"
										type="number"
										value={rule.priority}
									/>
								</div>
								<div className="col-xs-12 col-sm-3">
									<select
										className="form-control"
										onChange={(event) => updateRule(ruleIndex, (currentRule) => ({ ...currentRule, sortType: event.target.value as SortType }))}
										value={rule.sortType}
									>
										<option value="mostRecent">Most Recent</option>
										<option value="shortest">Shortest</option>
									</select>
								</div>
								<div className="col-xs-12 col-sm-2">
									<button className="btn btn-danger btn-sm" onClick={() => removeRule(ruleIndex)} type="button">
										<span className="glyphicon glyphicon-trash" /> Remove Rule
									</button>
								</div>
							</div>
						</div>
						<div className="panel-body">
							{rule.conditions.length === 0 ? (
								<p className="text-muted">No conditions defined.</p>
							) : rule.conditions.map((condition, conditionIndex) => (
								<div className="row" key={`${ruleIndex}-${conditionIndex}`} style={{ marginBottom: '10px' }}>
									<div className="col-xs-12 col-sm-3">
										<select
											className="form-control"
											onChange={(event) => updateCondition(ruleIndex, conditionIndex, (currentCondition) => ({
												...currentCondition,
												type: event.target.value as ConditionType,
											}))}
											value={condition.type}
										>
											<option value="sender_name">Sender Name</option>
											<option value="sender_email">Sender Email</option>
											<option value="subject">Subject</option>
										</select>
									</div>
									<div className="col-xs-12 col-sm-7">
										<input
											className="form-control"
											onChange={(event) => updateCondition(ruleIndex, conditionIndex, (currentCondition) => ({
												...currentCondition,
												value: event.target.value,
											}))}
											placeholder="Value to match"
											type="text"
											value={condition.value}
										/>
									</div>
									<div className="col-xs-12 col-sm-2">
										<button className="btn btn-default btn-sm" onClick={() => removeCondition(ruleIndex, conditionIndex)} type="button">
											<span className="glyphicon glyphicon-remove" /> Remove
										</button>
									</div>
								</div>
							))}
							<button className="btn btn-info btn-sm" onClick={() => addCondition(ruleIndex)} type="button">
								<span className="glyphicon glyphicon-plus" /> Add Condition
							</button>
						</div>
					</div>
				))}
			</div>
			<div style={{ marginTop: '15px' }}>
				<button className="btn btn-primary" disabled={loading || saving} onClick={saveRules} type="button">
					{saving ? 'Saving...' : 'Save Rules'}
				</button>
			</div>
		</div>
	);
}

export function mountGroupingRulesIsland({ api, container, onSaved }: {
	api: GroupingRulesApi;
	container: Element;
	onSaved?: () => void;
}) {
	const root = createRoot(container);
	let reloadToken = 0;

	function renderApp() {
		root.render(
			<GroupingRulesApp
				api={api}
				onSaved={onSaved}
				reloadToken={reloadToken}
			/>
		);
	}

	renderApp();

	return {
		refresh() {
			reloadToken += 1;
			renderApp();
		},
		unmount() {
			root.unmount();
		},
	};
}

export const mount = mountGroupingRulesIsland;
