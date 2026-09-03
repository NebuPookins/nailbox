import type { ConditionType, GroupingRule, GroupingRulesConfig } from './thread_grouping.js';

/**
 * Resolves the pattern to display for `conditionType`: the value the user
 * already typed for that condition type, if any, otherwise a per-type
 * default (the sender's email for `sender_email`, empty for the others).
 * Keeping one stored value per condition type means switching the trigger
 * dropdown never leaks a value typed for a different condition type.
 */
export function resolvePattern(
	patternsByType: Partial<Record<ConditionType, string>>,
	conditionType: ConditionType,
	senderEmail: string,
): string {
	const stored = patternsByType[conditionType];
	if (stored !== undefined) {
		return stored;
	}
	return conditionType === 'sender_email' ? senderEmail : '';
}

/**
 * Lists the substrings a rule already matches on for the given condition type,
 * for display. Returns the empty string when the rule has no such conditions.
 */
export function describeConditions(rule: GroupingRule, conditionType: ConditionType): string {
	return rule.conditions
		.filter(function(condition) { return condition.type === conditionType; })
		.map(function(condition) { return condition.value; })
		.filter(Boolean)
		.join(', ');
}

/**
 * Returns a copy of `config` where the rule at `ruleIndex` also matches on
 * `value` for the given condition type. The rule is left alone when it
 * already has that exact condition, and an out-of-range index leaves the
 * config as-is.
 */
export function addCondition(
	config: GroupingRulesConfig,
	ruleIndex: number,
	conditionType: ConditionType,
	value: string,
): GroupingRulesConfig {
	return {
		...config,
		rules: config.rules.map(function(rule, index) {
			if (index !== ruleIndex) {
				return rule;
			}
			const alreadyPresent = rule.conditions.some(function(condition) {
				return condition.type === conditionType && condition.value === value;
			});
			if (alreadyPresent) {
				return rule;
			}
			return {
				...rule,
				conditions: rule.conditions.concat([{ type: conditionType, value }]),
			};
		}),
	};
}
