export type GroupingCondition =
	| {type: 'sender_name'; value: string}
	| {type: 'sender_email'; value: string}
	| {type: 'subject'; value: string};

export interface GroupingRule {
	name: string;
	priority: number;
	sortType: 'mostRecent' | 'shortest';
	conditions: GroupingCondition[];
}

export interface GroupingRulesConfig {
	rules: GroupingRule[];
}

export const WHEN_I_HAVE_TIME_SUFFIX = ' - When I Have Time';

/**
 * The groups an item is shown in, given the names of the rules it matches (in
 * rule order). Rules are views, not a sort: the item appears once under each
 * distinct matching rule name, and only falls into "Others" when it matches
 * none. "When I have time" items go to each group's When I Have Time section.
 */
export function groupLabelsFor(isWhenIHaveTime: boolean, matchedRuleNames: readonly string[]): string[] {
	const baseLabels = matchedRuleNames.length > 0 ? [...new Set(matchedRuleNames)] : ['Others'];
	return isWhenIHaveTime ? baseLabels.map((label) => `${label}${WHEN_I_HAVE_TIME_SUFFIX}`) : baseLabels;
}
