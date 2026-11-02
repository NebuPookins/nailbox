import type {ThreadSortInfo} from '../../../models/hide_until.js';
import type {AppConfig} from '../types/config.js';
import {groupLabelsFor, WHEN_I_HAVE_TIME_SUFFIX, type GroupingRule, type GroupingRulesConfig} from '../types/grouping_rules.js';
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

/**
 * The member a bundle stands in for: the most recently updated of those with
 * the most prominent visibility. memberThreads must not be empty.
 */
function representativeMember(memberThreads: ThreadSummaryDto[]): ThreadSummaryDto {
	return memberThreads.reduce((best, thread) => {
		const priorityDifference = VISIBILITY_PRIORITY[thread.visibility] - VISIBILITY_PRIORITY[best.visibility];
		return priorityDifference > 0 || (priorityDifference === 0 && thread.lastUpdated > best.lastUpdated) ? thread : best;
	});
}

export function computeBundleVisibility(memberThreads: ThreadSummaryDto[]): ThreadSummaryDto['visibility'] {
	return representativeMember(memberThreads).visibility;
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
	if (item.type !== 'bundle') {
		return threadMatchesRule(item, rule);
	}
	// A bundle matches if any of its member threads matches.
	return item.memberThreads.some((thread) => threadMatchesRule(thread, rule));
}

/**
 * What the hide-until comparator ranks an item by. Hide-untils are recorded
 * per thread, never per bundle, so a bundle ranks as its representative member.
 */
function sortKeyOf(item: ThreadRowItem): ThreadSortInfo {
	const {threadId, lastUpdated} = item.type === 'bundle' ? representativeMember(item.memberThreads) : item;
	return {threadId, lastUpdated};
}

export function groupThreads(
	threads: ThreadSummaryDto[],
	bundles: BundleDto[] = [],
	groupingRules: GroupingRulesConfig,
	hideUntilComparator: (a: ThreadSortInfo, b: ThreadSortInfo) => number,
	maxItemsPerGroup: number = Infinity,
): ThreadGroupDto[] {
	function itemComparator(a: ThreadRowItem, b: ThreadRowItem): number {
		return hideUntilComparator(sortKeyOf(a), sortKeyOf(b));
	}
	const groupedItems: Record<string, ThreadRowItem[]> = {};

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

	allItems.forEach((item) => {
		const matchedRuleNames = groupingRules.rules.filter((rule) => itemMatchesRule(item, rule)).map((rule) => rule.name);
		groupLabelsFor(item.visibility === 'when-i-have-time', matchedRuleNames).forEach((key) => {
			(groupedItems[key] ??= []).push(item);
		});
	});

	const orderedGroupThreads: ThreadGroupDto[] = Object.keys(groupedItems).map((group) => {
		let sortType: 'mostRecent' | 'shortest' = 'mostRecent';
		for (const rule of groupingRules.rules) {
			if (rule.name === group || (group.endsWith(WHEN_I_HAVE_TIME_SUFFIX) && rule.name === group.replace(WHEN_I_HAVE_TIME_SUFFIX, ''))) {
				sortType = rule.sortType || 'mostRecent';
				break;
			}
		}

		// Every group gets its own quota of the most relevant items, so a flood of
		// mail in one group can't crowd the others out.
		const mostRelevantItems = [...groupedItems[group]].sort(itemComparator).slice(0, maxItemsPerGroup);
		const sortedItems = sortType === 'shortest'
			? mostRelevantItems.sort((a, b) => a.totalTimeToReadSeconds - b.totalTimeToReadSeconds)
			: mostRelevantItems;

		const threadItems = sortedItems.filter((item): item is ThreadSummaryDto => item.type !== 'bundle');

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
		const labelA = groupA.label.replace(WHEN_I_HAVE_TIME_SUFFIX, '');
		const labelB = groupB.label.replace(WHEN_I_HAVE_TIME_SUFFIX, '');
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
