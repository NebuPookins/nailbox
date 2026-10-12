/**
 * The items whose key hasn't appeared earlier in the array, in input order.
 */
export function uniqBy<T>(items: readonly T[], key: (item: T) => unknown): T[] {
	const seenKeys = new Set<unknown>();
	return items.filter((item) => {
		const itemKey = key(item);
		if (seenKeys.has(itemKey)) {
			return false;
		}
		seenKeys.add(itemKey);
		return true;
	});
}

/**
 * The item with the highest score (the earliest one on ties), or undefined if
 * no item has a score that is a number (NaN scores are skipped).
 */
export function maxBy<T>(items: readonly T[], score: (item: T) => number): T | undefined {
	return items
		.map((item) => ({item, itemScore: score(item)}))
		.filter(({itemScore}) => !Number.isNaN(itemScore))
		.reduce<{item: T; itemScore: number} | undefined>(
			(best, candidate) => best === undefined || candidate.itemScore > best.itemScore ? candidate : best,
			undefined,
		)?.item;
}
