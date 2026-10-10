import type { ThreadGroup, ThreadRowItem } from './thread_grouping.js';

/** A row that left the latest groups and is still playing its removal animation. */
export interface AnimatingRow {
	/** Identifies this animation, so a timer only clears the animation it started. */
	token: number;
	item: ThreadRowItem;
	groupLabel: string;
	/** Key of the item that preceded this one in its group, or null if it was first. */
	precededBy: string | null;
}

export function itemKey(item: ThreadRowItem): string {
	return item.type === 'bundle' ? 'bundle:' + item.bundleId : 'thread:' + item.threadId;
}

function threadIdsOf(items: readonly ThreadRowItem[]): Set<string> {
	return new Set(items.flatMap(function(item) {
		return item.type === 'bundle' ? item.threadIds : [item.threadId];
	}));
}

/**
 * A thread is gone when no row in the groups holds it. A bundle is gone only when neither its id
 * nor any of its member threads is present, so a bundle that shrinks or dissolves is not "removed".
 */
export function goneItems(previous: readonly ThreadGroup[], latest: readonly ThreadGroup[]): Omit<AnimatingRow, 'token'>[] {
	const latestItems = latest.flatMap(function(group) { return group.items; });
	const latestThreadIds = threadIdsOf(latestItems);
	const latestBundleIds = new Set(latestItems.flatMap(function(item) {
		return item.type === 'bundle' ? [item.bundleId] : [];
	}));
	return previous.flatMap(function(group) {
		return group.items.flatMap(function(item, index): Omit<AnimatingRow, 'token'>[] {
			const isGone = item.type === 'bundle'
				? !latestBundleIds.has(item.bundleId) && !item.threadIds.some(function(id) { return latestThreadIds.has(id); })
				: !latestThreadIds.has(item.threadId);
			const preceding = group.items[index - 1];
			return isGone
				? [{ item, groupLabel: group.label, precededBy: preceding ? itemKey(preceding) : null }]
				: [];
		});
	});
}

/**
 * The latest groups, plus the animating rows re-inserted where they used to be: after the row
 * that preceded them (or first, if they were first), or at the end of their group when that row
 * is gone too. A row whose group vanished gets a group of its own at the end. Rows already
 * present in the latest groups are not duplicated.
 */
export function groupsWithAnimatingRows(
	latest: readonly ThreadGroup[],
	animatingRows: ReadonlyMap<string, AnimatingRow>,
): ThreadGroup[] {
	const presentKeys = new Set(latest.flatMap(function(group) { return group.items.map(itemKey); }));
	return [...animatingRows.values()]
		.filter(function(row) { return !presentKeys.has(itemKey(row.item)); })
		.reduce<ThreadGroup[]>(function(groups, row) {
			const hasGroup = groups.some(function(group) { return group.label === row.groupLabel; });
			const withGroup = hasGroup ? groups : [...groups, { label: row.groupLabel, items: [] }];
			return withGroup.map(function(group) {
				if (group.label !== row.groupLabel) {
					return group;
				}
				const precedingIndex = row.precededBy === null
					? -1
					: group.items.findIndex(function(item) { return itemKey(item) === row.precededBy; });
				const insertAt = row.precededBy !== null && precedingIndex === -1 ? group.items.length : precedingIndex + 1;
				return { ...group, items: [...group.items.slice(0, insertAt), row.item, ...group.items.slice(insertAt)] };
			});
		}, latest.map(function(group) { return { ...group, items: [...group.items] }; }));
}
