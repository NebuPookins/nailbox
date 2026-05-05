import type {
	ConditionType,
	GroupingCondition,
	GroupingRule,
	GroupingRulesConfig,
	ThreadRowItem,
	ThreadSummary,
} from './thread_grouping.js';

export interface ConditionMatchDetail {
	field: string;
	value: string;
	matched: boolean;
}

export interface ConditionTrace {
	type: ConditionType;
	value: string;
	matched: boolean;
	reason: string;
	details: ConditionMatchDetail[];
}

export interface RuleTrace {
	ruleName: string;
	priority: number;
	conditions: ConditionTrace[];
	matched: boolean;
	skipped: boolean;
	skippedReason?: string;
}

export interface GroupingTrace {
	rules: RuleTrace[];
	matchedRuleName: string | null;
	finalGroupLabel: string;
}

const WHEN_I_HAVE_TIME_SUFFIX = ' - When I Have Time';

function describeCondition(condition: GroupingCondition): string {
	switch (condition.type) {
		case 'sender_name':
			return `Sender name contains "${condition.value}"`;
		case 'sender_email':
			return `Sender email contains "${condition.value}"`;
		case 'subject':
			return `Subject contains "${condition.value}"`;
		default:
			return `Unknown condition type`;
	}
}

function evaluateCondition(item: ThreadRowItem, condition: GroupingCondition): ConditionTrace {
	const description = describeCondition(condition);
	switch (condition.type) {
		case 'sender_name': {
			const senders = item.senders || [];
			const details: ConditionMatchDetail[] = senders.map((sender) => ({
				field: 'sender name',
				value: sender.name || '(no name)',
				matched: Boolean(sender.name && sender.name.includes(condition.value)),
			}));
			const matched = details.some((d) => d.matched);
			const reason = matched
				? `${description}: matched at least one sender name.`
				: senders.length === 0
					? `${description}: no senders to compare against.`
					: `${description}: no sender name contained "${condition.value}".`;
			return {type: condition.type, value: condition.value, matched, reason, details};
		}
		case 'sender_email': {
			const senders = item.senders || [];
			const details: ConditionMatchDetail[] = senders.map((sender) => ({
				field: 'sender email',
				value: sender.email || '(no email)',
				matched: Boolean(sender.email && sender.email.includes(condition.value)),
			}));
			const matched = details.some((d) => d.matched);
			const reason = matched
				? `${description}: matched at least one sender email.`
				: senders.length === 0
					? `${description}: no senders to compare against.`
					: `${description}: no sender email contained "${condition.value}".`;
			return {type: condition.type, value: condition.value, matched, reason, details};
		}
		case 'subject': {
			if (item.type === 'bundle') {
				return {
					type: condition.type,
					value: condition.value,
					matched: false,
					reason: `${description}: bundles do not have a single subject, so subject conditions never match for bundles.`,
					details: [],
				};
			}
			const thread = item as ThreadSummary;
			const subject = thread.subject || '';
			const matched = Boolean(subject && subject.includes(condition.value));
			const detail: ConditionMatchDetail = {
				field: 'subject',
				value: subject || '(no subject)',
				matched,
			};
			const reason = matched
				? `${description}: matched the thread subject.`
				: subject.length === 0
					? `${description}: thread has no subject.`
					: `${description}: subject did not contain "${condition.value}".`;
			return {type: condition.type, value: condition.value, matched, reason, details: [detail]};
		}
		default:
			return {
				type: condition.type,
				value: condition.value,
				matched: false,
				reason: `Unknown condition type "${(condition as {type: string}).type}".`,
				details: [],
			};
	}
}

function evaluateRule(item: ThreadRowItem, rule: GroupingRule): {matched: boolean; conditions: ConditionTrace[]} {
	if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
		return {matched: false, conditions: []};
	}
	const conditions = rule.conditions.map((condition) => evaluateCondition(item, condition));
	const matched = conditions.some((c) => c.matched);
	return {matched, conditions};
}

export function traceGrouping(item: ThreadRowItem, groupingRules: GroupingRulesConfig): GroupingTrace {
	const rules = Array.isArray(groupingRules?.rules) ? groupingRules.rules : [];
	const ruleTraces: RuleTrace[] = [];
	let matchedRuleName: string | null = null;

	for (const rule of rules) {
		if (matchedRuleName !== null) {
			ruleTraces.push({
				ruleName: rule.name,
				priority: rule.priority,
				conditions: [],
				matched: false,
				skipped: true,
				skippedReason: `An earlier rule already matched.`,
			});
			continue;
		}
		const {matched, conditions} = evaluateRule(item, rule);
		ruleTraces.push({
			ruleName: rule.name,
			priority: rule.priority,
			conditions,
			matched,
			skipped: false,
		});
		if (matched) {
			matchedRuleName = rule.name;
		}
	}

	const baseLabel = matchedRuleName ?? 'Others';
	const finalGroupLabel = item.visibility === 'when-i-have-time'
		? `${baseLabel}${WHEN_I_HAVE_TIME_SUFFIX}`
		: baseLabel;

	return {
		rules: ruleTraces,
		matchedRuleName,
		finalGroupLabel,
	};
}
