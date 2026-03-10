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
