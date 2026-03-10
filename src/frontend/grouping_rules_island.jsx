import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function createEmptyRule() {
	return {
		name: 'New Rule',
		priority: 50,
		sortType: 'mostRecent',
		conditions: [],
	};
}

function normalizeRule(rule) {
	return {
		name: typeof rule?.name === 'string' ? rule.name : '',
		priority: Number.isFinite(Number(rule?.priority)) ? Number(rule.priority) : 50,
		sortType: rule?.sortType === 'shortest' ? 'shortest' : 'mostRecent',
		conditions: Array.isArray(rule?.conditions) ? rule.conditions.map((condition) => ({
			type: condition?.type === 'sender_name' || condition?.type === 'sender_email' || condition?.type === 'subject'
				? condition.type
				: 'sender_email',
			value: typeof condition?.value === 'string' ? condition.value : '',
		})) : [],
	};
}

function GroupingRulesApp({ api, notify, onSaved, reloadToken }) {
	const [rules, setRules] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');

	useEffect(() => {
		let isCancelled = false;
		setLoading(true);
		setErrorMessage('');
		Promise.resolve(api.loadRules())
			.then((data) => {
				if (isCancelled) {
					return;
				}
				const nextRules = Array.isArray(data?.rules) ? data.rules.map(normalizeRule) : [];
				setRules(nextRules);
			})
			.catch(() => {
				if (isCancelled) {
					return;
				}
				setErrorMessage('Failed to load email grouping rules.');
				notify?.error?.('Failed to load email grouping rules');
			})
			.finally(() => {
				if (!isCancelled) {
					setLoading(false);
				}
			});
		return () => {
			isCancelled = true;
		};
	}, [api, notify, reloadToken]);

	function updateRule(ruleIndex, updater) {
		setRules((currentRules) => currentRules.map((rule, index) => (
			index === ruleIndex ? updater(rule) : rule
		)));
	}

	function addRule() {
		setRules((currentRules) => currentRules.concat(createEmptyRule()));
	}

	function removeRule(ruleIndex) {
		setRules((currentRules) => currentRules.filter((_, index) => index !== ruleIndex));
	}

	function addCondition(ruleIndex) {
		updateRule(ruleIndex, (rule) => ({
			...rule,
			conditions: rule.conditions.concat({ type: 'sender_email', value: '' }),
		}));
	}

	function updateCondition(ruleIndex, conditionIndex, updater) {
		updateRule(ruleIndex, (rule) => ({
			...rule,
			conditions: rule.conditions.map((condition, index) => (
				index === conditionIndex ? updater(condition) : condition
			)),
		}));
	}

	function removeCondition(ruleIndex, conditionIndex) {
		updateRule(ruleIndex, (rule) => ({
			...rule,
			conditions: rule.conditions.filter((_, index) => index !== conditionIndex),
		}));
	}

	function saveRules() {
		setSaving(true);
		setErrorMessage('');
		Promise.resolve(api.saveRules({ rules }))
			.then(() => {
				notify?.success?.('Email grouping rules saved successfully');
				onSaved?.();
			})
			.catch(() => {
				setErrorMessage('Failed to save email grouping rules.');
				notify?.error?.('Failed to save email grouping rules');
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
										onChange={(event) => updateRule(ruleIndex, (currentRule) => ({ ...currentRule, sortType: event.target.value }))}
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
												type: event.target.value,
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

export function mountGroupingRulesIsland({ api, container, notify, onSaved }) {
	const root = createRoot(container);
	let reloadToken = 0;

	function renderApp() {
		root.render(
			<GroupingRulesApp
				api={api}
				notify={notify}
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
