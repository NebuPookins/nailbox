import type {AppConfig} from '../types/config.js';
import type {GroupingRule, GroupingRulesConfig} from '../types/grouping_rules.js';
import type {ThreadSummaryDto, ThreadGroupDto} from '../types/thread.js';
import {normalizeGroupingRulesConfig} from '../validation/contracts.js';

export function getEmailGroupingRules(config: AppConfig): GroupingRulesConfig {
	return normalizeGroupingRulesConfig(config.emailGroupingRules);
}

export function threadMatchesRule(thread: ThreadSummaryDto, rule: GroupingRule): boolean {
	return rule.conditions.some((condition) => {
		switch (condition.type) {
			case 'sender_name':
				return thread.senders.some((sender) =>
					sender.name && sender.name.includes(condition.value)
				);
			case 'sender_email':
				return thread.senders.some((sender) =>
					sender.email && sender.email.includes(condition.value)
				);
			case 'subject':
				return Boolean(thread.subject && thread.subject.includes(condition.value));
			default:
				return false;
		}
	});
}

export function groupThreads({threads, groupingRules, hideUntilComparator}: {
	threads: ThreadSummaryDto[];
	groupingRules: GroupingRulesConfig;
	hideUntilComparator: (a: ThreadSummaryDto, b: ThreadSummaryDto) => number;
}): ThreadGroupDto[] {
	const groupedThreads: Record<string, ThreadSummaryDto[]> = {};
	const whenIHaveTimeSuffix = ' - When I Have Time';

	function addToGroupedThreads(group: string, thread: ThreadSummaryDto): void {
		const key = thread.visibility === 'when-i-have-time' ? `${group}${whenIHaveTimeSuffix}` : group;
		if (!Array.isArray(groupedThreads[key])) {
			groupedThreads[key] = [];
		}
		groupedThreads[key].push(thread);
	}

	threads.forEach((thread) => {
		let foundAGroup = false;
		for (const rule of groupingRules.rules) {
			if (threadMatchesRule(thread, rule)) {
				addToGroupedThreads(rule.name, thread);
				foundAGroup = true;
				break;
			}
		}
		if (!foundAGroup) {
			addToGroupedThreads('Others', thread);
		}
	});

	const orderedGroupThreads: ThreadGroupDto[] = Object.keys(groupedThreads).map((group) => {
		let sortType: 'mostRecent' | 'shortest' = 'mostRecent';
		for (const rule of groupingRules.rules) {
			if (rule.name === group || (group.endsWith(whenIHaveTimeSuffix) && rule.name === group.replace(whenIHaveTimeSuffix, ''))) {
				sortType = rule.sortType || 'mostRecent';
				break;
			}
		}

		const sortedThreads = [...groupedThreads[group]];
		if (sortType === 'shortest') {
			sortedThreads.sort((a, b) => a.totalTimeToReadSeconds - b.totalTimeToReadSeconds);
		} else {
			sortedThreads.sort(hideUntilComparator);
		}

		return {
			label: group,
			threads: sortedThreads,
			sortType,
		};
	});

	orderedGroupThreads.sort((groupA, groupB) => hideUntilComparator(groupA.threads[0], groupB.threads[0]));

	const groupPriority: Record<string, number> = {};
	groupingRules.rules.forEach((rule) => {
		groupPriority[rule.name] = rule.priority;
	});

	orderedGroupThreads.sort((groupA, groupB) => {
		const labelA = groupA.label.replace(whenIHaveTimeSuffix, '');
		const labelB = groupB.label.replace(whenIHaveTimeSuffix, '');
		const whenIHaveTimeA = labelA !== groupA.label;
		const whenIHaveTimeB = labelB !== groupB.label;
		if (whenIHaveTimeA && !whenIHaveTimeB) {
			return 1;
		}
		if (!whenIHaveTimeA && whenIHaveTimeB) {
			return -1;
		}
		if (groupPriority[labelA]) {
			if (groupPriority[labelB]) {
				return groupPriority[labelA] - groupPriority[labelB];
			}
			return 1;
		}
		if (groupPriority[labelB]) {
			return -1;
		}
		return 0;
	});

	return orderedGroupThreads;
}
