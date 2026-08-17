import type { GroupingRule, GroupingRulesConfig } from './thread_grouping.js';

/**
 * Lists the sender email substrings a rule already matches on, for display.
 * Returns the empty string when the rule has no sender email conditions.
 */
export function describeSenderConditions(rule: GroupingRule): string {
	return rule.conditions
		.filter(function(condition) { return condition.type === 'sender_email'; })
		.map(function(condition) { return condition.value; })
		.filter(Boolean)
		.join(', ');
}

/**
 * Returns a copy of `config` where the rule at `ruleIndex` also matches senders
 * whose email address contains `value`. The rule is left alone when it already
 * has that exact condition, and an out-of-range index leaves the config as-is.
 */
export function addSenderEmailCondition(
	config: GroupingRulesConfig,
	ruleIndex: number,
	value: string,
): GroupingRulesConfig {
	return {
		...config,
		rules: config.rules.map(function(rule, index) {
			if (index !== ruleIndex) {
				return rule;
			}
			const alreadyPresent = rule.conditions.some(function(condition) {
				return condition.type === 'sender_email' && condition.value === value;
			});
			if (alreadyPresent) {
				return rule;
			}
			return {
				...rule,
				conditions: rule.conditions.concat([{ type: 'sender_email', value: value }]),
			};
		}),
	};
}
