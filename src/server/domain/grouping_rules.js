import { normalizeGroupingRulesConfig } from '../validation/contracts.js';

/**
 * @param {import('../types/config.js').AppConfig} config
 */
export function getEmailGroupingRules(config) {
	return normalizeGroupingRulesConfig(config.emailGroupingRules);
}

/**
 * @param {import('../types/thread.js').ThreadSummaryDto} thread
 * @param {import('../types/grouping_rules.js').GroupingRule} rule
 */
export function threadMatchesRule(thread, rule) {
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
				return thread.subject && thread.subject.includes(condition.value);
			default:
				return false;
		}
	});
}

/**
 * @param {{
 *   threads: import('../types/thread.js').ThreadSummaryDto[],
 *   groupingRules: import('../types/grouping_rules.js').GroupingRulesConfig,
 *   hideUntilComparator: (a: import('../types/thread.js').ThreadSummaryDto, b: import('../types/thread.js').ThreadSummaryDto) => number,
 * }} params
 */
export function groupThreads({threads, groupingRules, hideUntilComparator}) {
	/** @type {Record<string, import('../types/thread.js').ThreadSummaryDto[]>} */
	const groupedThreads = {};
	const whenIHaveTimeSuffix = ' - When I Have Time';

	/**
	 * @param {string} group
	 * @param {import('../types/thread.js').ThreadSummaryDto} thread
	 */
	function addToGroupedThreads(group, thread) {
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

	const orderedGroupThreads = Object.keys(groupedThreads).map((group) => {
		let sortType = 'mostRecent';
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

	/** @type {Record<string, number>} */
	const groupPriority = {};
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
