type Visibility = 'updated' | 'visible' | 'when-i-have-time' | 'stale' | 'hidden';
export type SortType = 'mostRecent' | 'shortest';
export type ConditionType = 'sender_name' | 'sender_email' | 'subject';

interface Person {
	name: string;
	email: string;
}

export interface ThreadSummary {
	type?: 'thread';
	threadId: string;
	senders: Person[];
	receivers: Person[];
	lastUpdated: number;
	subject: string;
	snippet: string | null;
	messageIds: string[];
	labelIds: string[];
	visibility: Visibility;
	totalTimeToReadSeconds: number;
	recentMessageReadTimeSeconds: number;
}

export interface BundleSummary {
	type: 'bundle';
	bundleId: string;
	threadIds: string[];
	senders: Person[];
	lastUpdated: number;
	subject?: string;
	snippet?: string | null;
	visibility: Visibility;
	threadCount: number;
	memberThreads?: ThreadSummary[];
	totalTimeToReadSeconds: number;
	recentMessageReadTimeSeconds: number;
}

export type ThreadRowItem = ThreadSummary | BundleSummary;

export interface ThreadGroup {
	label: string;
	items: ThreadRowItem[];
	sortType?: SortType;
}

export interface GroupingCondition {
	type: ConditionType;
	value: string;
}

export interface GroupingRule {
	name: string;
	priority: number;
	sortType: SortType;
	conditions: GroupingCondition[];
}

export interface GroupingRulesConfig {
	rules: GroupingRule[];
}

export interface BundleData {
	bundleId: string;
	threadIds: string[];
}

const VISIBILITY_PRIORITY: Record<Visibility, number> = {
	updated: 5,
	visible: 4,
	'when-i-have-time': 3,
	stale: 2,
	hidden: 1,
};

export function buildBundleSummary(bundle: BundleData, memberThreads: ThreadSummary[]): BundleSummary {
	const seenEmails = new Set<string>();
	const dedupedSenders = memberThreads
		.flatMap(function(thread) { return thread.senders || []; })
		.filter(function(sender) {
			if (!sender?.email || seenEmails.has(sender.email)) {
				return false;
			}
			seenEmails.add(sender.email);
			return true;
		});
	const latestThread = memberThreads.reduce(function(latest, thread) {
		return thread.lastUpdated > latest.lastUpdated ? thread : latest;
	}, memberThreads[0]);
	const visibility = memberThreads.reduce(function(best, thread) {
		return VISIBILITY_PRIORITY[thread.visibility] > VISIBILITY_PRIORITY[best]
			? thread.visibility
			: best;
	}, 'hidden' as Visibility);
	const totalTimeToReadSeconds = memberThreads.reduce(function(sum, t) { return sum + t.totalTimeToReadSeconds; }, 0);
	return {
		type: 'bundle',
		bundleId: bundle.bundleId,
		threadIds: bundle.threadIds,
		senders: dedupedSenders,
		lastUpdated: latestThread.lastUpdated,
		subject: latestThread.subject,
		snippet: latestThread.snippet,
		visibility: visibility,
		threadCount: memberThreads.length,
		memberThreads: memberThreads,
		totalTimeToReadSeconds,
		recentMessageReadTimeSeconds: latestThread.recentMessageReadTimeSeconds,
	};
}

export function groupThreads({
	threads,
	bundles,
	groupingRules,
	orderedItemIds,
}: {
	threads: ThreadSummary[];
	bundles: BundleData[];
	groupingRules: GroupingRulesConfig;
	orderedItemIds: string[];
}): ThreadGroup[] {
	const itemOrder = new Map<string, number>();
	orderedItemIds.forEach(function(id, index) {
		itemOrder.set(id, index);
	});
	const groupedItems: Record<string, ThreadRowItem[]> = {};
	const whenIHaveTimeSuffix = ' - When I Have Time';
	const bundledThreadIds = new Set<string>();
	const threadById = new Map<string, ThreadSummary>();

	threads.forEach(function(thread) {
		threadById.set(thread.threadId, thread);
	});
	bundles.forEach(function(bundle) {
		bundle.threadIds.forEach(function(threadId) {
			bundledThreadIds.add(threadId);
		});
	});

	const bundleItems = bundles.map(function(bundle) {
		const memberThreads = bundle.threadIds
			.map(function(threadId) { return threadById.get(threadId); })
			.filter(function(thread): thread is ThreadSummary { return Boolean(thread); });
		return memberThreads.length > 0 ? buildBundleSummary(bundle, memberThreads) : null;
	}).filter(function(bundle): bundle is BundleSummary { return Boolean(bundle); });

	const allItems: ThreadRowItem[] = [
		...threads.filter(function(thread) { return !bundledThreadIds.has(thread.threadId); }),
		...bundleItems,
	];

	function getItemId(item: ThreadRowItem): string {
		return item.type === 'bundle' ? item.bundleId : item.threadId;
	}

	function threadMatchesRule(thread: ThreadSummary, rule: GroupingRule): boolean {
		return rule.conditions.some(function(condition) {
			switch (condition.type) {
				case 'sender_name':
					return thread.senders.some(function(sender) {
						return sender.name && sender.name.includes(condition.value);
					});
				case 'sender_email':
					return thread.senders.some(function(sender) {
						return sender.email && sender.email.includes(condition.value);
					});
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
		const memberThreads = item.memberThreads || [];
		return memberThreads.some(function(thread) {
			return threadMatchesRule(thread, rule);
		});
	}

	function addToGroup(groupName: string, item: ThreadRowItem): void {
		const key = item.visibility === 'when-i-have-time' ? `${groupName}${whenIHaveTimeSuffix}` : groupName;
		if (!Array.isArray(groupedItems[key])) {
			groupedItems[key] = [];
		}
		groupedItems[key].push(item);
	}

	allItems.forEach(function(item) {
		for (const rule of groupingRules.rules) {
			if (itemMatchesRule(item, rule)) {
				addToGroup(rule.name, item);
				return;
			}
		}
		addToGroup('Others', item);
	});

	const groups = Object.keys(groupedItems).map(function(groupName) {
		let sortType: SortType = 'mostRecent';
		for (const rule of groupingRules.rules) {
			if (rule.name === groupName || groupName === `${rule.name}${whenIHaveTimeSuffix}`) {
				sortType = rule.sortType || 'mostRecent';
				break;
			}
		}
		const sortedItems = [...groupedItems[groupName]];
		if (sortType === 'shortest') {
			sortedItems.sort(function(a, b) {
				const aTime = a.type === 'thread' ? a.totalTimeToReadSeconds : 0;
				const bTime = b.type === 'thread' ? b.totalTimeToReadSeconds : 0;
				if (aTime !== bTime) {
					return aTime - bTime;
				}
				return (itemOrder.get(getItemId(a)) ?? Number.MAX_SAFE_INTEGER) - (itemOrder.get(getItemId(b)) ?? Number.MAX_SAFE_INTEGER);
			});
		} else {
			sortedItems.sort(function(a, b) {
				return (itemOrder.get(getItemId(a)) ?? Number.MAX_SAFE_INTEGER) - (itemOrder.get(getItemId(b)) ?? Number.MAX_SAFE_INTEGER);
			});
		}
		return {
			label: groupName,
			items: sortedItems,
			sortType: sortType,
		};
	});

	const groupPriority: Record<string, number> = {};
	groupingRules.rules.forEach(function(rule) {
		groupPriority[rule.name] = rule.priority;
	});

	groups.sort(function(groupA, groupB) {
		const labelA = groupA.label.replace(whenIHaveTimeSuffix, '');
		const labelB = groupB.label.replace(whenIHaveTimeSuffix, '');
		const whenIHaveTimeA = labelA !== groupA.label;
		const whenIHaveTimeB = labelB !== groupB.label;
		if (whenIHaveTimeA && !whenIHaveTimeB) return 1;
		if (!whenIHaveTimeA && whenIHaveTimeB) return -1;
		if (groupPriority[labelA] && groupPriority[labelB]) {
			return groupPriority[labelA] - groupPriority[labelB];
		}
		if (groupPriority[labelA]) return 1;
		if (groupPriority[labelB]) return -1;
		const firstA = groupA.items[0];
		const firstB = groupB.items[0];
		return (itemOrder.get(firstA ? getItemId(firstA) : '') ?? Number.MAX_SAFE_INTEGER) -
			(itemOrder.get(firstB ? getItemId(firstB) : '') ?? Number.MAX_SAFE_INTEGER);
	});

	return groups;
}

