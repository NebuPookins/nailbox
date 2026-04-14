import type {AppConfig} from '../types/config.js';
import type {GroupingRule, GroupingRulesConfig} from '../types/grouping_rules.js';
import type {ThreadSummaryDto, BundleSummaryDto, ThreadRowItem, ThreadGroupDto} from '../types/thread.js';
import type {BundleDto} from '../types/bundle.js';
import {normalizeGroupingRulesConfig} from '../validation/contracts.js';

export function getEmailGroupingRules(config: AppConfig): GroupingRulesConfig {
	return normalizeGroupingRulesConfig(config.emailGroupingRules);
}

const VISIBILITY_PRIORITY: Record<ThreadSummaryDto['visibility'], number> = {
	'updated': 5,
	'visible': 4,
	'when-i-have-time': 3,
	'stale': 2,
	'hidden': 1,
};

export function computeBundleVisibility(memberThreads: ThreadSummaryDto[]): ThreadSummaryDto['visibility'] {
	let best: ThreadSummaryDto['visibility'] = 'hidden';
	for (const thread of memberThreads) {
		if (VISIBILITY_PRIORITY[thread.visibility] > VISIBILITY_PRIORITY[best]) {
			best = thread.visibility;
		}
	}
	return best;
}

export function buildBundleSummary(bundle: BundleDto, memberThreads: ThreadSummaryDto[]): BundleSummaryDto {
	const allSenders = memberThreads.flatMap((t) => t.senders);
	const seenEmails = new Set<string>();
	const dedupedSenders = allSenders.filter((s) => {
		if (!s.email) return true;
		if (seenEmails.has(s.email)) return false;
		seenEmails.add(s.email);
		return true;
	});
	const latestThread = memberThreads.reduce((latest, t) => t.lastUpdated > latest.lastUpdated ? t : latest, memberThreads[0]);
	const lastUpdated = latestThread.lastUpdated;
	const visibility = computeBundleVisibility(memberThreads);
	const totalTimeToReadSeconds = memberThreads.reduce((sum, t) => sum + t.totalTimeToReadSeconds, 0);
	return {
		type: 'bundle',
		bundleId: bundle.bundleId,
		threadIds: bundle.threadIds,
		senders: dedupedSenders,
		lastUpdated,
		subject: latestThread.subject,
		snippet: latestThread.snippet,
		visibility,
		isWhenIHaveTime: visibility === 'when-i-have-time',
		threadCount: memberThreads.length,
		memberThreads,
		totalTimeToReadSeconds,
		recentMessageReadTimeSeconds: latestThread.recentMessageReadTimeSeconds,
	};
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

function itemMatchesRule(item: ThreadRowItem, rule: GroupingRule): boolean {
	if (item.type === 'thread') {
		return threadMatchesRule(item, rule);
	}
	// For bundles, match against the bundle's deduplicated senders
	return rule.conditions.some((condition) => {
		switch (condition.type) {
			case 'sender_name':
				return item.senders.some((s) => s.name && s.name.includes(condition.value));
			case 'sender_email':
				return item.senders.some((s) => s.email && s.email.includes(condition.value));
			case 'subject':
				return false; // bundles don't have a single subject
			default:
				return false;
		}
	});
}

export function groupThreads({threads, bundles = [], groupingRules, hideUntilComparator}: {
	threads: ThreadSummaryDto[];
	bundles?: BundleDto[];
	groupingRules: GroupingRulesConfig;
	hideUntilComparator: (a: {threadId: string; lastUpdated: number}, b: {threadId: string; lastUpdated: number}) => number;
}): ThreadGroupDto[] {
	// Wrap the comparator to handle bundles (project bundleId as threadId for sorting)
	function itemComparator(a: ThreadRowItem, b: ThreadRowItem): number {
		const aProxy = {
			threadId: a.type === 'bundle' ? a.bundleId : a.threadId,
			lastUpdated: a.lastUpdated,
		};
		const bProxy = {
			threadId: b.type === 'bundle' ? b.bundleId : b.threadId,
			lastUpdated: b.lastUpdated,
		};
		return hideUntilComparator(aProxy, bProxy);
	}
	const groupedItems: Record<string, ThreadRowItem[]> = {};
	const whenIHaveTimeSuffix = ' - When I Have Time';

	// Build a set of all bundled thread IDs so we can exclude them from solo display
	const bundledThreadIds = new Set<string>();
	for (const bundle of bundles) {
		for (const tid of bundle.threadIds) {
			bundledThreadIds.add(tid);
		}
	}

	// Build a lookup map for threads by ID
	const threadById = new Map<string, ThreadSummaryDto>();
	for (const thread of threads) {
		threadById.set(thread.threadId, thread);
	}

	// Build bundle summary items
	const bundleItems: BundleSummaryDto[] = [];
	for (const bundle of bundles) {
		const memberThreads = bundle.threadIds
			.map((id) => threadById.get(id))
			.filter((t): t is ThreadSummaryDto => t !== undefined);
		if (memberThreads.length > 0) {
			bundleItems.push(buildBundleSummary(bundle, memberThreads));
		}
	}

	// Filter out bundled threads from solo thread list
	const soloThreads = threads.filter((t) => !bundledThreadIds.has(t.threadId));

	// Combine solo threads and bundle items into a single list of row items
	const allItems: ThreadRowItem[] = [...soloThreads, ...bundleItems];

	function addToGroupedItems(group: string, item: ThreadRowItem): void {
		const key = item.visibility === 'when-i-have-time' ? `${group}${whenIHaveTimeSuffix}` : group;
		if (!Array.isArray(groupedItems[key])) {
			groupedItems[key] = [];
		}
		groupedItems[key].push(item);
	}

	allItems.forEach((item) => {
		let foundAGroup = false;
		for (const rule of groupingRules.rules) {
			if (itemMatchesRule(item, rule)) {
				addToGroupedItems(rule.name, item);
				foundAGroup = true;
				break;
			}
		}
		if (!foundAGroup) {
			addToGroupedItems('Others', item);
		}
	});

	const orderedGroupThreads: ThreadGroupDto[] = Object.keys(groupedItems).map((group) => {
		let sortType: 'mostRecent' | 'shortest' = 'mostRecent';
		for (const rule of groupingRules.rules) {
			if (rule.name === group || (group.endsWith(whenIHaveTimeSuffix) && rule.name === group.replace(whenIHaveTimeSuffix, ''))) {
				sortType = rule.sortType || 'mostRecent';
				break;
			}
		}

		const sortedItems = [...groupedItems[group]];
		if (sortType === 'shortest') {
			sortedItems.sort((a, b) => {
				const aTime = a.type === 'thread' ? a.totalTimeToReadSeconds : 0;
				const bTime = b.type === 'thread' ? b.totalTimeToReadSeconds : 0;
				return aTime - bTime;
			});
		} else {
			sortedItems.sort(itemComparator);
		}

		const threadItems = sortedItems.filter((item): item is ThreadSummaryDto => item.type === 'thread');

		return {
			label: group,
			threads: threadItems,
			items: sortedItems,
			sortType,
		};
	});

	orderedGroupThreads.sort((groupA, groupB) => itemComparator(groupA.items[0], groupB.items[0]));

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
